import type {
  Connection,
  GrantToolAccess,
  PlatformAccess,
} from "api-server-api";

import type { ConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import type { XactLock } from "../../core/xact-lock.js";
import type { ProviderModelCatalog } from "../../modules/connections/services/provider-model-catalog.js";
import type { DamKeyPort } from "../../modules/connections/domain/dam-connection.js";
import type {
  McpToolLister,
  McpToolListOutcome,
} from "../../modules/connections/domain/tool-access.js";

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

/** UNIT_BOUNDARY_DESCRIPTION: the launching parent of every Agent in a suite with no child Agents: none, so each new grant takes the starting access. */
export const noConnectionsParent = async (): Promise<string | null> => null;

export interface FakeMcpToolLister extends McpToolLister {
  calls: { url: string; headers: Record<string, string> }[];
  answer: McpToolListOutcome;
}

export function fakeMcpToolLister(
  answer: McpToolListOutcome = { ok: true, tools: [] },
): FakeMcpToolLister {
  const lister: FakeMcpToolLister = {
    calls: [],
    answer,
    list: async (url, headers) => {
      lister.calls.push({ url: url.toString(), headers });
      return lister.answer;
    },
  };
  return lister;
}

export interface StoredSecret {
  fields: Record<string, string>;
  annotations: Record<string, string>;
  purpose: string;
}

export interface ConnectionsStore {
  rows: Map<string, Connection>;
  grants: Set<string>;
  grantAccess: Map<string, GrantToolAccess | null>;
  platformAccess: Map<string, PlatformAccess>;
  secrets: Map<string, StoredSecret>;
}

export const newConnectionsStore = (): ConnectionsStore => ({
  rows: new Map(),
  grants: new Set(),
  grantAccess: new Map(),
  platformAccess: new Map(),
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
    putFields: async (ref, fields) =>
      void secrets.set(ref.path, {
        fields: { ...(secrets.get(ref.path)?.fields ?? {}), ...fields },
        annotations: secrets.get(ref.path)?.annotations ?? {},
        purpose: secrets.get(ref.path)?.purpose ?? "connection",
      }),
    getField: async (ref) => {
      reads.getField++;
      return secrets.get(ref.path)?.fields[ref.field] ?? null;
    },
    delete: async (ref) => void secrets.delete(ref.path),
  });
}

export function serviceHarness(opts: {
  templates: ConnectionTemplateRegistry;
  ownerId?: string;
  mirroredChildren?: (agentId: string) => Promise<string[]>;
  parentOf?: (agentId: string) => Promise<string | null>;
  store?: ConnectionsStore;
  lock?: XactLock;
  brandName: string;
  curveBenderDeploymentKey?: string | null;
  damKey?: DamKeyPort;
  damConnectionOffered?: () => Promise<boolean>;
  toolApprovalOffered?: () => Promise<boolean>;
  mcpToolLister?: McpToolLister;
  insert?: (row: Connection) => Promise<void>;
  adoptDamKey?: (input: {
    id: string;
    keyId: string;
    previousKeyId: string | null;
  }) => Promise<void>;
  providerModelCatalog?: ProviderModelCatalog;
}) {
  const store = opts.store ?? newConnectionsStore();
  const { rows, grants, grantAccess, platformAccess, secrets } = store;
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
    parentOf: opts.parentOf ?? noConnectionsParent,
    harnesses: { default: "claude-code", harnesses: [] },
    isOwnedAgent: async () => true,
    ownerId: opts.ownerId ?? "owner",
    templates: opts.templates,
    repo: unused<ConnectionsRepository>({
      insert:
        opts.insert ??
        (async (c) => {
          if ([...rows.values()].some((r) => r.name === c.name))
            throw Object.assign(new Error("duplicate"), { code: "23505" });
          rows.set(c.id, c);
        }),
      get: async (id, ownerId) => {
        const row = rows.get(id);
        return row?.ownerId === ownerId ? row : null;
      },
      listByOwner: async () => [...rows.values()],
      listChildren: async (parentId) =>
        [...rows.values()].filter((c) => c.parentId === parentId),
      listByOwnerOldestFirst: async () => [...rows.values()],
      mergeInputs: async (id, patch) =>
        void rows.set(id, {
          ...rows.get(id)!,
          inputs: { ...rows.get(id)!.inputs, ...patch },
        }),
      adoptDamKey:
        opts.adoptDamKey ??
        (async ({ id, keyId }) => {
          const row = rows.get(id);
          if (!row) return;
          rows.set(id, { ...row, inputs: { ...row.inputs, apiKeyId: keyId } });
        }),
      updateContributions: async (id, contributions) =>
        void rows.set(id, { ...rows.get(id)!, contributions }),
      updateAuth: async (id, auth) =>
        void rows.set(id, { ...rows.get(id)!, auth }),
      updateToolAccess: async (id, toolAccess) =>
        void rows.set(id, { ...rows.get(id)!, toolAccess }),
      updateName: async (id, name) =>
        void rows.set(id, { ...rows.get(id)!, name }),
      delete: async (id) => {
        rows.delete(id);
        for (const g of grants) if (g.startsWith(`${id}|`)) grants.delete(g);
      },
      grant: async (c, a, toolAccess) => {
        if (grants.has(grantKey(c, a))) return;
        grants.add(grantKey(c, a));
        grantAccess.set(grantKey(c, a), toolAccess);
      },
      revoke: async (c, a) => {
        grants.delete(grantKey(c, a));
        grantAccess.delete(grantKey(c, a));
        platformAccess.delete(grantKey(c, a));
      },
      setGrantToolAccess: async (c, a, toolAccess) => {
        if (!grants.has(grantKey(c, a))) return false;
        grantAccess.set(grantKey(c, a), toolAccess);
        return true;
      },
      setGrantPlatformAccess: async (c, a, access) => {
        if (!grants.has(grantKey(c, a))) return false;
        if (access === null) platformAccess.delete(grantKey(c, a));
        else platformAccess.set(grantKey(c, a), access);
        return true;
      },
      clearGrantToolAccess: async (c) => {
        for (const key of grantAccess.keys())
          if (key.startsWith(`${c}|`)) grantAccess.set(key, null);
      },
      listGrantedConnections: async (agentId) =>
        [...rows.values()]
          .filter((c) => grants.has(grantKey(c.id, agentId)))
          .map((connection) => ({
            connection,
            toolAccess:
              grantAccess.get(grantKey(connection.id, agentId)) ?? null,
          })),
      listAgentGrants: async (agentId) =>
        [...rows.keys()]
          .filter((c) => grants.has(grantKey(c, agentId)))
          .map((connectionId) => ({
            connectionId,
            grantedAt: new Date(0),
            preferred: false,
            toolAccess:
              grantAccess.get(grantKey(connectionId, agentId)) ?? null,
            platformAccess:
              platformAccess.get(grantKey(connectionId, agentId)) ?? null,
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
    providerModelCatalog: opts.providerModelCatalog ?? unused(),
    oauthCallbackUrl: "https://example.com/callback",
    brandName: opts.brandName,
    connectionLock: opts.lock ?? keyedMutex(),
    resolveKbShare: unused(),
    curveBenderDeploymentKey: opts.curveBenderDeploymentKey ?? null,
    ...(opts.damKey ? { damKey: opts.damKey } : {}),
    damConnectionOffered: opts.damConnectionOffered ?? (async () => true),
    toolApprovalOffered: opts.toolApprovalOffered ?? (async () => true),
    ...(opts.mirroredChildren
      ? { mirroredChildren: opts.mirroredChildren }
      : {}),
    mcpToolLister: opts.mcpToolLister ?? fakeMcpToolLister(),
  });
  return {
    svc,
    store,
    rows,
    grants,
    grantAccess,
    secrets,
    fannedOut,
    secretReads,
  };
}
