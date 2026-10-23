import type { Connection } from "api-server-api";

import type { ConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import type { XactLock } from "../../core/xact-lock.js";

/**
 * TEST_OVERVIEW: the in-memory Connections store and service wiring the
 * deployment-owned provider tests read, so the deployment CurveBender's
 * regressions run against one fake.
 */
export function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

export function keyedMutex(): XactLock {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const run = (tails.get(key) ?? Promise.resolve()).then(fn);
    tails.set(
      key,
      run.catch(() => {}),
    );
    return run;
  };
}

export interface StoredSecret {
  fields: Record<string, string>;
  annotations: Record<string, string>;
  purpose: string;
}

export interface ConnectionsStore {
  rows: Map<string, Connection>;
  grants: Set<string>;
  secrets: Map<string, StoredSecret>;
}

export const newConnectionsStore = (): ConnectionsStore => ({
  rows: new Map(),
  grants: new Set(),
  secrets: new Map(),
});

export interface SecretReads {
  get: number;
  getField: number;
}

export function memorySecretStore(
  secrets: Map<string, StoredSecret>,
  reads: SecretReads = { get: 0, getField: 0 },
): SecretStore {
  let minted = 0;
  return unused<SecretStore>({
    storeId: "test",
    mintRef: (meta) => ({
      storeId: "test",
      path: `${meta.purpose}-${++minted}`,
      field: "",
    }),
    put: async (ref, fields, meta) =>
      void secrets.set(ref.path, {
        fields,
        annotations: meta.extraAnnotations ?? {},
        purpose: meta.purpose,
      }),
    get: async (ref) => {
      reads.get++;
      return secrets.get(ref.path)?.fields ?? null;
    },
    getField: async (ref) => {
      reads.getField++;
      return secrets.get(ref.path)?.fields[ref.field] ?? null;
    },
    delete: async (ref) => void secrets.delete(ref.path),
  });
}

export function serviceHarness(opts: {
  templates: ConnectionTemplateRegistry;
  store?: ConnectionsStore;
  lock?: XactLock;
  brandName: string;
  curveBenderDeploymentKey?: string | null;
}) {
  const { rows, grants, secrets } = opts.store ?? newConnectionsStore();
  const secretReads: SecretReads = { get: 0, getField: 0 };
  const fannedOut: string[] = [];
  const grantKey = (connectionId: string, agentId: string) =>
    `${connectionId}|${agentId}`;
  const agentsOf = (connectionId: string) =>
    [...grants]
      .map((g) => g.split("|"))
      .filter(([c]) => c === connectionId)
      .map(([, a]) => a!);
  const svc = createConnectionsService({
    harnesses: { default: "claude-code", harnesses: [] },
    isOwnedAgent: async () => true,
    ownerId: "owner",
    templates: opts.templates,
    repo: unused<ConnectionsRepository>({
      insert: async (c) => {
        if ([...rows.values()].some((r) => r.name === c.name))
          throw Object.assign(new Error("duplicate"), { code: "23505" });
        rows.set(c.id, c);
      },
      get: async (id) => rows.get(id) ?? null,
      listByOwner: async () => [...rows.values()],
      listByOwnerOldestFirst: async () => [...rows.values()],
      updateContributions: async (id, contributions) =>
        void rows.set(id, { ...rows.get(id)!, contributions }),
      updateName: async (id, name) =>
        void rows.set(id, { ...rows.get(id)!, name }),
      delete: async (id) => {
        rows.delete(id);
        for (const g of grants) if (g.startsWith(`${id}|`)) grants.delete(g);
      },
      grant: async (c, a) => void grants.add(grantKey(c, a)),
      revoke: async (c, a) => void grants.delete(grantKey(c, a)),
      listAgentGrants: async (agentId) =>
        [...rows.keys()]
          .filter((c) => grants.has(grantKey(c, agentId)))
          .map((connectionId) => ({
            connectionId,
            grantedAt: new Date(0),
            preferred: false,
          })),
      listAgentsForConnection: async (id) =>
        rows.has(id) ? ["agent-1", ...agentsOf(id)] : [],
      listConnectionsForAgent: async (agentId) =>
        [...rows.values()].filter((c) => grants.has(grantKey(c.id, agentId))),
    }),
    secretStore: memorySecretStore(secrets, secretReads),
    fanOut: unused({
      apply: async (input) => void fannedOut.push(input.agentId),
    }),
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    s3CredentialProbe: unused(),
    providerBalance: unused(),
    credentialProbe: { probe: async () => ({ status: "passed" }) },
    providerKeyProbe: { probe: async () => ({ ok: true }) },
    oauthCallbackUrl: "https://example.com/callback",
    brandName: opts.brandName,
    connectionLock: opts.lock ?? keyedMutex(),
    resolveKbShare: unused(),
    curveBenderDeploymentKey: opts.curveBenderDeploymentKey ?? null,
  });
  return { svc, rows, grants, secrets, fannedOut, secretReads };
}
