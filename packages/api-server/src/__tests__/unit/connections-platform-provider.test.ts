import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_TEMPLATE_IDS,
  providerTypeForTemplateId,
  type Connection,
} from "api-server-api";

import { attachProviderToBareAgents } from "../../modules/agents/compose.js";
import {
  buildCatalog,
  type PlatformProviderEndpoint,
} from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import { startAttachFirstProviderSaga } from "../../modules/connections/sagas/attach-first-provider.js";
import {
  startPlatformProviderSaga,
  sweepPlatformConnections,
} from "../../modules/connections/sagas/platform-provider.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import type { XactLock } from "../../core/xact-lock.js";
import { configureLogger } from "../../core/logger.js";
import { emit, events$, EventType } from "../../events.js";

/**
 * TEST_OVERVIEW: the built-in provider's Connection follows its feature flag:
 * turning the flag on gives the user exactly one platform-llm Connection
 * named after the brand, whose Secret holds the operator's key for the
 * gateway to inject, and which the attach-first-provider saga grants to a
 * bare agent; turning it off, or the operator dropping the model server or
 * its key, removes it and revokes it from the agents holding it; an existing
 * one follows the operator's endpoint, key and the brand; only the
 * user-facing listing reconciles; and the user cannot create, update or
 * delete it by hand.
 */

configureLogger({ level: "error", write: () => {} });

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

const ENDPOINT: PlatformProviderEndpoint = {
  baseUrl: "https://llm.models.svc:8443",
  model: "m-flash",
  name: "Acme",
};

function keyedMutex(): XactLock {
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

interface StoredSecret {
  fields: Record<string, string>;
  annotations: Record<string, string>;
  purpose: string;
}

interface Store {
  rows: Map<string, Connection>;
  grants: Set<string>;
  secrets: Map<string, StoredSecret>;
}

const newStore = (): Store => ({
  rows: new Map(),
  grants: new Set(),
  secrets: new Map(),
});

function memorySecretStore(secrets: Map<string, StoredSecret>): SecretStore {
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
    getField: async (ref) => secrets.get(ref.path)?.fields[ref.field] ?? null,
    delete: async (ref) => void secrets.delete(ref.path),
  });
}

function makeService(
  opts: {
    endpoint?: PlatformProviderEndpoint | null;
    apiKey?: string | null;
    store?: Store;
    lock?: XactLock;
    flag?: { on: boolean };
  } = {},
) {
  const { rows, grants, secrets } = opts.store ?? newStore();
  const endpoint = opts.endpoint === undefined ? ENDPOINT : opts.endpoint;
  const fannedOut: string[] = [];
  const flag = opts.flag ?? { on: false };
  const grantKey = (connectionId: string, agentId: string) =>
    `${connectionId}|${agentId}`;
  const agentsOf = (connectionId: string) =>
    [...grants]
      .map((g) => g.split("|"))
      .filter(([c]) => c === connectionId)
      .map(([, a]) => a!);
  const svc = createConnectionsService({
    isOwnedAgent: async () => true,
    ownerId: "owner",
    templates: createConnectionTemplateRegistry(
      buildCatalog({}, { platformProvider: endpoint }),
    ),
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
    secretStore: memorySecretStore(secrets),
    fanOut: unused({
      apply: async (input) => void fannedOut.push(input.agentId),
    }),
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    s3CredentialProbe: unused(),
    providerBalance: unused(),
    providerKeyProbe: { probe: async () => ({ ok: true }) },
    oauthCallbackUrl: "https://example.com/callback",
    brandName: endpoint?.name ?? "Acme",
    connectionLock: opts.lock ?? keyedMutex(),
    resolveKbShare: unused(),
    platformProviderEnabled: async () => flag.on,
    platformProviderKey:
      opts.apiKey === undefined ? "sk-operator" : opts.apiKey,
  });
  return { svc, rows, grants, secrets, flag, fannedOut };
}

const platformRows = (rows: Map<string, Connection>) =>
  [...rows.values()].filter((c) => c.templateId === "platform-llm");

function secretOf(store: Pick<Store, "secrets">, conn: Connection) {
  if (conn.auth.kind !== "header") throw new Error("not a header Connection");
  return store.secrets.get(conn.auth.valueRef.path);
}

const injectionHosts = (secret: StoredSecret | undefined) =>
  JSON.parse(secret?.annotations["agent-platform.ai/injection-hosts"] ?? "[]");

const userConnection = (name: string): Connection => ({
  id: `conn-${name}`,
  ownerId: "owner",
  templateId: "github",
  name,
  inputs: {},
  auth: { kind: "none" },
  contributions: [],
});

const subs: { unsubscribe(): void }[] = [];
afterEach(() => {
  for (const s of subs.splice(0)) s.unsubscribe();
});

function toggle(on: boolean, flag: { on: boolean }, owner = "owner") {
  flag.on = on;
  emit({
    type: EventType.FeatureFlagChanged,
    actorSub: owner,
    surface: "test",
    feature: "platform-provider",
    enabled: on,
  });
}

describe("platform provider connection", () => {
  // TEST_SCENARIO: enabling the feature twice and listing in between leaves one Connection named after the brand, whose Secret holds the operator's key as the bearer the gateway injects on the server's host and port, and which the attach-first-provider saga grants to an agent holding no provider.
  it("creates exactly one connection when the flag is turned on and grants it to a bare agent", async () => {
    const { svc, rows, grants, secrets, flag } = makeService();
    subs.push(startPlatformProviderSaga(() => svc));
    subs.push(
      startAttachFirstProviderSaga((_owner, connectionId) =>
        attachProviderToBareAgents(
          svc,
          { harnesses: [] },
          [{ id: "agent-1", spec: {} }],
          connectionId,
        ),
      ),
    );

    toggle(true, flag);
    await vi.waitFor(() => expect(platformRows(rows)).toHaveLength(1));
    toggle(true, flag);
    const views = await svc.listAndReconcileConnections();

    const [conn] = platformRows(rows);
    expect(platformRows(rows)).toHaveLength(1);
    await vi.waitFor(() =>
      expect(grants).toEqual(new Set([`${conn!.id}|agent-1`])),
    );
    const view = views.find((v) => v.templateId === "platform-llm")!;
    expect(view).toMatchObject({
      name: "Acme",
      status: "active",
      authKind: "header",
      category: "app",
      hosts: ["llm.models.svc"],
    });
    expect(view.contributions).toContainEqual({
      kind: "egress-inject",
      host: "llm.models.svc",
      port: 8443,
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    });
    expect(view.contributions).toContainEqual({
      kind: "env",
      name: "OPENAI_BASE_URL",
      placeholder: "https://llm.models.svc:8443/v1",
    });
    const secret = secretOf({ secrets }, conn!);
    expect(secret?.purpose).toBe("connection:platform-llm");
    expect(secret?.fields.value).toBe("sk-operator");
    expect(Object.values(secret!.fields)).toContainEqual(
      expect.stringContaining('"Bearer sk-operator"'),
    );
    expect(injectionHosts(secret)).toEqual([
      expect.objectContaining({ host: "llm.models.svc", port: 8443 }),
    ]);
    expect(PROVIDER_TEMPLATE_IDS.has("platform-llm")).toBe(true);
    expect(providerTypeForTemplateId("platform-llm")).toBe("platform");
  });

  // TEST_SCENARIO: with the install's mode on there is no flag change, so the first user-facing listing provisions the Connection, while the internal listing agent paths use creates nothing.
  it("provisions the connection lazily only on the user-facing listing", async () => {
    const { svc, rows, flag } = makeService();
    flag.on = true;
    await svc.listConnections();
    expect(platformRows(rows)).toHaveLength(0);
    await svc.listAndReconcileConnections();
    await svc.listAndReconcileConnections();
    expect(platformRows(rows)).toHaveLength(1);
  });

  // TEST_SCENARIO: a listing with the flag off removes a Connection left over from when it was on.
  it("removes a leftover connection on listing while the flag is off", async () => {
    const { svc, rows, flag, fannedOut } = makeService();
    flag.on = true;
    await svc.reconcilePlatformConnection();
    flag.on = false;

    await svc.listAndReconcileConnections();
    expect(platformRows(rows)).toHaveLength(0);
    expect(fannedOut).toEqual(["agent-1"]);
  });

  // TEST_SCENARIO: disabling the feature removes the Connection and re-delivers the agents that held it.
  it("removes the connection when the flag is turned off", async () => {
    const { svc, rows, flag, fannedOut } = makeService();
    flag.on = true;
    await svc.reconcilePlatformConnection();
    subs.push(startPlatformProviderSaga(() => svc));

    toggle(false, flag);
    await vi.waitFor(() => expect(platformRows(rows)).toHaveLength(0));
    expect(fannedOut).toEqual(["agent-1"]);
  });

  // TEST_SCENARIO: a listing that read the flag on and an off-event racing it on another replica leave no Connection, because the flag is read under the per-owner lock.
  it("leaves no connection when an off-event interleaves with a listing", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const mutex = keyedMutex();
    const entered: string[] = [];
    const lock: XactLock = async (key, fn) => {
      if (key.startsWith("platform-llm:")) {
        entered.push(key);
        await gate;
      }
      return mutex(key, fn);
    };
    const store = newStore();
    const flag = { on: true };
    const listing = makeService({ store, lock, flag });
    const saga = makeService({ store, lock, flag });
    subs.push(startPlatformProviderSaga(() => saga.svc));

    const listed = listing.svc.listAndReconcileConnections();
    await vi.waitFor(() => expect(entered).toHaveLength(1));
    toggle(false, flag);
    await new Promise((resolve) => setTimeout(resolve, 20));
    open();
    await listed;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(platformRows(store.rows)).toHaveLength(0);
  });

  // TEST_SCENARIO: one owner's slow reconcile does not hold up another owner's flag change.
  it("serializes flag changes per owner, not globally", async () => {
    const { svc, rows, flag } = makeService();
    subs.push(
      startPlatformProviderSaga((owner) =>
        owner === "slow"
          ? { reconcilePlatformConnection: () => new Promise(() => {}) }
          : svc,
      ),
    );

    toggle(true, { on: true }, "slow");
    toggle(true, flag);
    await vi.waitFor(() => expect(platformRows(rows)).toHaveLength(1));
  });

  // TEST_SCENARIO: an existing Connection follows the operator's new model, endpoint and brand, its Secret names the new host for injection, and the agents holding it are re-delivered.
  it("refreshes an existing connection when the operator changes the endpoint", async () => {
    const store = newStore();
    const before = makeService({ store });
    before.flag.on = true;
    await before.svc.reconcilePlatformConnection();
    const [old] = platformRows(store.rows);

    const after = makeService({
      store,
      endpoint: {
        baseUrl: "https://other.svc:9443",
        model: "m-pro",
        name: "Zed",
      },
    });
    after.flag.on = true;
    await after.svc.listAndReconcileConnections();

    const [conn] = platformRows(store.rows);
    expect(conn!.id).toBe(old!.id);
    expect(conn!.name).toBe("Zed");
    expect(conn!.contributions).toContainEqual({
      kind: "env",
      name: "OPENAI_MODEL",
      placeholder: "m-pro",
    });
    expect(conn!.contributions).toContainEqual(
      expect.objectContaining({
        kind: "egress-inject",
        host: "other.svc",
        port: 9443,
      }),
    );
    expect(injectionHosts(secretOf(store, conn!))).toEqual([
      expect.objectContaining({ host: "other.svc", port: 9443 }),
    ]);
    expect(after.fannedOut).toEqual(["agent-1"]);
  });

  // TEST_SCENARIO: a user who already owns Connections named after the brand gets the built-in provider under the next free fallback name.
  it("falls back to a free name when the brand name is taken", async () => {
    const store = newStore();
    for (const name of ["Acme", "Acme LLM"])
      store.rows.set(`conn-${name}`, userConnection(name));
    const { svc, rows, flag } = makeService({ store });
    flag.on = true;

    await svc.listAndReconcileConnections();
    await svc.listAndReconcileConnections();
    expect(platformRows(rows).map((c) => c.name)).toEqual(["Acme LLM 2"]);
  });

  // TEST_SCENARIO: the boot sweep removes every built-in provider Connection once the operator no longer names a model server, re-delivering the agents.
  it("sweeps leftover connections when no model server is configured", async () => {
    const store = newStore();
    const before = makeService({ store });
    before.flag.on = true;
    await before.svc.reconcilePlatformConnection();

    const after = makeService({ store, endpoint: null });
    after.flag.on = true;
    await sweepPlatformConnections(
      async () => ["owner"],
      () => after.svc,
    );
    expect(platformRows(store.rows)).toHaveLength(0);
    expect(after.fannedOut).toEqual(["agent-1"]);
  });

  // TEST_SCENARIO: the user's own delete, create and update paths refuse the built-in provider, so its Secret keeps the operator's key.
  it("refuses to delete, create or update the connection by hand", async () => {
    const { svc, rows, flag } = makeService();
    flag.on = true;
    await svc.reconcilePlatformConnection();
    const [conn] = platformRows(rows);

    await expect(svc.deleteConnection(conn!.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      svc.createFromTemplate({
        templateId: "platform-llm",
        name: "mine",
        authKind: "none",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      svc.update(conn!.id, { value: "sk-mine" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(platformRows(rows)).toHaveLength(1);
  });

  // TEST_SCENARIO: when the operator rotates the key, the next listing rewrites the Connection's Secret with the new key in place and re-delivers the agents holding it, once.
  it("rewrites the secret and fans out when the operator key rotates", async () => {
    const store = newStore();
    const before = makeService({ store });
    before.flag.on = true;
    await before.svc.reconcilePlatformConnection();
    const [old] = platformRows(store.rows);

    const after = makeService({ store, apiKey: "sk-rotated" });
    after.flag.on = true;
    await after.svc.listAndReconcileConnections();
    await after.svc.listAndReconcileConnections();

    const [conn] = platformRows(store.rows);
    expect(conn!.id).toBe(old!.id);
    const secret = secretOf(store, conn!);
    expect(secret?.fields.value).toBe("sk-rotated");
    expect(Object.values(secret!.fields)).toContainEqual(
      expect.stringContaining('"Bearer sk-rotated"'),
    );
    expect(after.fannedOut).toEqual(["agent-1"]);
  });

  // TEST_SCENARIO: a keyless Connection left from before the provider was metered has no Secret to rewrite, so a listing replaces it with one holding the key.
  it("replaces a keyless connection with a keyed one", async () => {
    const store = newStore();
    store.rows.set("conn-old", {
      ...userConnection("Acme"),
      id: "conn-old",
      templateId: "platform-llm",
    });
    const { svc, flag } = makeService({ store });
    flag.on = true;

    await svc.listAndReconcileConnections();
    const [conn] = platformRows(store.rows);
    expect(conn!.id).not.toBe("conn-old");
    expect(secretOf(store, conn!)?.fields.value).toBe("sk-operator");
  });

  // TEST_SCENARIO: an install that names a model server but no key offers no built-in provider: a flag that reads on creates nothing, and a leftover Connection is removed.
  it("creates nothing and removes a leftover without an operator key", async () => {
    const store = newStore();
    const before = makeService({ store });
    before.flag.on = true;
    await before.svc.reconcilePlatformConnection();

    const after = makeService({ store, apiKey: null });
    after.flag.on = true;
    await after.svc.listAndReconcileConnections();
    expect(platformRows(store.rows)).toHaveLength(0);
    expect(store.secrets.size).toBe(0);
  });

  // TEST_SCENARIO: an install with no model server has no template, so even a flag that reads on creates nothing.
  it("creates nothing without a configured base URL", async () => {
    const { svc, rows, flag } = makeService({ endpoint: null });
    flag.on = true;
    await svc.listAndReconcileConnections();
    expect(rows.size).toBe(0);
    expect(buildCatalog().some((t) => t.id === "platform-llm")).toBe(false);
  });
});
