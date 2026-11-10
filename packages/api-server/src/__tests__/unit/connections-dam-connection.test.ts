import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import {
  AGENT_SCOPES,
  CREDENTIAL_SCOPES,
  DAM_TEMPLATE_ID,
  type ApiKeysService,
  type Connection,
  type ConnectionTemplateView,
} from "api-server-api";

import { configureLogger } from "../../core/logger.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import {
  DAM_KEY_INPUT,
  DAM_SERVER_ENV,
  DAM_TOKEN_ENV,
  damKeyPortFor,
  damTargetOf,
} from "../../modules/connections/domain/dam-connection.js";
import { CONNECTION_TOKEN_PLACEHOLDER } from "../../modules/connections/domain/connection-sds.js";
import {
  newConnectionsStore,
  serviceHarness,
  type StoredSecret,
} from "../helpers/connections-service.js";

/**
 * TEST_OVERVIEW: the Connection that lets an Agent drive this install as its
 * owner. It exists only where the install's own URL is one the gateway can
 * inject on; the platform mints one owner API key for it, keeps it in the
 * Connection's Secret, and the Agent's env carries the placeholders instead.
 * The key never shows up in a create input, a listing or a user's own create,
 * the Connection is grantable by its owner alone, and deleting it revokes the
 * key.
 */

configureLogger({ level: "error", write: () => {} });

const BASE_URL = "https://dam.example.com";
const BRAND = "Acme";

const templatesFor = (baseUrl = BASE_URL) =>
  createConnectionTemplateRegistry(
    buildCatalog({}, { damBaseUrl: baseUrl, brandName: BRAND }),
  );

const damTemplate = (baseUrl = BASE_URL): ConnectionTemplateView | undefined =>
  templatesFor(baseUrl)
    .list()
    .map((t) => t)
    .find((t) => t.id === DAM_TEMPLATE_ID) as
    ConnectionTemplateView | undefined;

function fakeKeys() {
  const calls: {
    name: string;
    scopes: readonly string[];
    agentIds: unknown;
  }[] = [];
  const revoked: string[] = [];
  const live = new Set<string>();
  let minted = 0;
  let refuseRevoke: Error | null = null;
  const keys: ApiKeysService = {
    list: async () => [],
    create: async (input) => {
      calls.push({
        name: input.name,
        scopes: input.scopes,
        agentIds: input.agentIds,
      });
      const id = `key-${++minted}`;
      live.add(id);
      return {
        key: {
          id,
          name: input.name,
          scopes: input.scopes,
          agentIds: "*",
          expiresAt: null,
          createdAt: "2026-11-09T00:00:00.000Z",
          lastUsedAt: null,
        },
        plaintext: `pk_secret_${id}`,
      };
    },
    revoke: async (id) => {
      if (refuseRevoke !== null) throw refuseRevoke;
      if (!live.delete(id))
        throw new TRPCError({ code: "NOT_FOUND", message: "no such key" });
      revoked.push(id);
    },
  };
  const directory = {
    activeKeyIds: async (ids: readonly string[]) =>
      new Set(ids.filter((id) => live.has(id))),
    deferRevocation: async (keyId: string) => void deferred.push(keyId),
  };
  const deferred: string[] = [];
  return {
    keys,
    directory,
    calls,
    revoked,
    live,
    deferred,
    refuseRevokeWith(err: Error | null) {
      refuseRevoke = err;
    },
  };
}

function harness(
  baseUrl = BASE_URL,
  opts: { insert?: (row: Connection) => Promise<void> } = {},
) {
  const store = newConnectionsStore();
  const keys = fakeKeys();
  const { svc } = serviceHarness({
    templates: templatesFor(baseUrl),
    store,
    brandName: BRAND,
    damKey: damKeyPortFor(keys.keys, keys.directory, BRAND),
    ...(opts.insert ? { insert: opts.insert } : {}),
  });
  return { svc, store, keys };
}

const damRows = (rows: Map<string, Connection>) =>
  [...rows.values()].filter((c) => c.templateId === DAM_TEMPLATE_ID);

function secretOf(
  secrets: Map<string, StoredSecret>,
  conn: Connection,
): StoredSecret | undefined {
  if (conn.auth.kind !== "header") throw new Error("not a header Connection");
  return secrets.get(conn.auth.valueRef.path);
}

describe("the DAM connection template", () => {
  it("exists only where the install's own URL is one the gateway can inject on", () => {
    expect(damTemplate()?.name).toBe(BRAND);
    expect(damTemplate("http://dam.example.com")).toBeUndefined();
    expect(damTemplate("https://localhost:4444")).toBeUndefined();
    expect(damTemplate("https://127.0.0.1")).toBeUndefined();
    expect(buildCatalog({}).some((t) => t.id === DAM_TEMPLATE_ID)).toBe(false);
  });

  it("carries the install's host and path-scoped injection", () => {
    const template = templatesFor().get(DAM_TEMPLATE_ID);
    if (!template || template.authKind !== "header") throw new Error("absent");
    expect(template.host).toBe("dam.example.com");
    const inject = template.contributions.find(
      (c) => c.kind === "egress-inject",
    );
    expect(inject).toMatchObject({
      host: "dam.example.com",
      pathPattern: "/api/",
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    });
    expect(
      template.contributions.find(
        (c) => c.kind === "egress-allow" && c.pathPattern === "/api/*",
      ),
    ).toBeDefined();
    expect(template.contributions).toEqual(
      expect.arrayContaining([
        { kind: "env", name: DAM_SERVER_ENV, placeholder: BASE_URL },
        {
          kind: "env",
          name: DAM_TOKEN_ENV,
          placeholder: CONNECTION_TOKEN_PLACEHOLDER,
        },
      ]),
    );
    const skill = template.contributions.find((c) => c.kind === "file");
    expect(skill).toMatchObject({
      path: "$HOME/.agents/skills/dam/SKILL.md",
      format: "text",
      mergeMode: "overwrite",
    });
    expect(String(skill?.kind === "file" && skill.content)).toMatch(
      /^---\nname: dam\ndescription: >\n/,
    );
    expect(damTargetOf("https://dam.example.com:8443")).toEqual({
      baseUrl: "https://dam.example.com:8443",
      host: "dam.example.com",
      port: 8443,
    });
  });
});

describe("provisioning the DAM connection", () => {
  it("mints one owner key, keeps it in the Secret, and hands the Agent placeholders", async () => {
    const { svc, store, keys } = harness();
    const id = await svc.ensureDamConnection();
    expect(id).not.toBeNull();
    expect(keys.calls).toEqual([
      {
        name: `${BRAND} connection`,
        scopes: [...AGENT_SCOPES, ...CREDENTIAL_SCOPES],
        agentIds: "*",
      },
    ]);

    const [conn] = damRows(store.rows);
    expect(conn?.name).toBe(BRAND);
    const secret = secretOf(store.secrets, conn!);
    expect(secret?.fields.value).toBe("pk_secret_key-1");
    expect(JSON.stringify(secret?.fields ?? {})).toContain("pk_secret_key-1");
    expect(
      JSON.parse(secret!.annotations["agent-platform.ai/injection-hosts"]),
    ).toEqual([
      expect.objectContaining({
        host: "dam.example.com",
        pathPattern: "/api/",
        headerName: "Authorization",
      }),
    ]);

    const view = await svc.getConnection(id!);
    expect(JSON.stringify(view)).not.toContain("pk_secret_key-1");
    expect(conn?.inputs[DAM_KEY_INPUT]).toBe("key-1");
    const env = (conn?.contributions ?? []).filter((c) => c.kind === "env");
    expect(env).toEqual([
      { kind: "env", name: DAM_SERVER_ENV, placeholder: BASE_URL },
      {
        kind: "env",
        name: DAM_TOKEN_ENV,
        placeholder: CONNECTION_TOKEN_PLACEHOLDER,
      },
    ]);
  });

  // TEST_SCENARIO: two requests arrive together — the first agent's create and a reset — and one Connection with one key comes out of them, because the per-owner lock makes the second find the first's.
  it("is one per owner, and mints nothing while one is held", async () => {
    const { svc, store, keys } = harness();
    const [first, second] = await Promise.all([
      svc.ensureDamConnection(),
      svc.ensureDamConnection(),
    ]);
    expect(second).toBe(first);
    expect(keys.calls).toHaveLength(1);
    expect(damRows(store.rows)).toHaveLength(1);
  });

  it("takes the first free name when the owner already used it", async () => {
    const { svc, store } = harness();
    await store.rows.set("conn-taken", {
      id: "conn-taken",
      ownerId: "owner",
      templateId: "custom-header",
      name: BRAND,
      inputs: {},
      auth: { kind: "none" },
      contributions: [],
    });
    await svc.ensureDamConnection();
    expect(damRows(store.rows).map((c) => c.name)).toEqual([`${BRAND} 2`]);
  });

  it("provisions nothing where the install's own URL cannot be injected on", async () => {
    const { svc, store, keys } = harness("http://localhost:4444");
    expect(await svc.ensureDamConnection()).toBeNull();
    expect(damRows(store.rows)).toHaveLength(0);
    expect(keys.calls).toHaveLength(0);
  });

  it("refuses a create or a credential update by hand", async () => {
    const { svc } = harness();
    await expect(
      svc.createFromTemplate({
        templateId: DAM_TEMPLATE_ID,
        name: "mine",
        authKind: "header",
        value: "pk_pasted",
      }),
    ).rejects.toThrow(/mints this Connection's credential/);

    const id = await svc.ensureDamConnection();
    await expect(svc.update(id!, { value: "pk_pasted" })).rejects.toThrow(
      /mints this Connection's credential/,
    );
  });

  it("revokes the key when the Connection is deleted, and mints a fresh one after", async () => {
    const { svc, store, keys } = harness();
    const id = await svc.ensureDamConnection();
    await svc.deleteConnection(id!);
    expect(keys.revoked).toEqual(["key-1"]);
    expect(damRows(store.rows)).toHaveLength(0);

    const again = await svc.ensureDamConnection();
    expect(again).not.toBe(id);
    expect(keys.calls).toHaveLength(2);
  });
});

describe("revoking the key", () => {
  // TEST_SCENARIO: the key store refuses the revocation, so the delete must fail and leave the Connection, its Secret and its grants exactly as they were — a Connection deleted first would lose the only record of the key that is still live.
  it("fails the delete and keeps everything when the key cannot be revoked", async () => {
    const { svc, store, keys } = harness();
    const id = await svc.ensureDamConnection();
    await svc.setAgentConnections("agent-1", [id!]);
    const secretPath = secretOf(store.secrets, damRows(store.rows)[0]!)!.fields
      .value;
    keys.refuseRevokeWith(new Error("directory down"));

    await expect(svc.deleteConnection(id!)).rejects.toThrow(
      /could not be revoked/,
    );
    expect(damRows(store.rows)).toHaveLength(1);
    expect(store.grants).toContain(`${id}|agent-1`);
    expect(secretOf(store.secrets, damRows(store.rows)[0]!)?.fields.value).toBe(
      secretPath,
    );
  });

  // TEST_SCENARIO: a key that is already revoked is not a failure — the delete proceeds, so a Connection whose key the owner revoked in Settings can still be removed.
  it("treats an already-revoked key as done", async () => {
    const { svc, store, keys } = harness();
    const id = await svc.ensureDamConnection();
    await keys.keys.revoke("key-1");
    await svc.deleteConnection(id!);
    expect(damRows(store.rows)).toHaveLength(0);
  });

  // TEST_SCENARIO: a create whose insert fails must not leave its freshly minted key live, and the error it fails with must not carry the key into the log.
  it("rolls a failed create back, and reports it without the key", async () => {
    const { svc, keys } = harness(BASE_URL, {
      insert: async () => {
        throw new Error("insert failed for pk_secret_key-1");
      },
    });
    await expect(svc.ensureDamConnection()).rejects.toThrow(
      /insert failed for \[redacted\]/,
    );
    expect(keys.revoked).toEqual(["key-1"]);
    expect(keys.deferred).toEqual([]);
  });

  // TEST_SCENARIO: with the key store down too, the rollback is written down for the sweep instead of being lost, so the orphan key is revoked later.
  it("defers a rollback it cannot complete", async () => {
    const { svc, keys } = harness(BASE_URL, {
      insert: async () => {
        throw new Error("insert failed");
      },
    });
    keys.refuseRevokeWith(new Error("directory down"));
    await expect(svc.ensureDamConnection()).rejects.toThrow(/insert failed/);
    expect(keys.deferred).toEqual(["key-1"]);
  });
});

describe("rotating the key", () => {
  // TEST_SCENARIO: rotating mints a new key into the same Connection — its id, its grants and every Agent's env untouched — and the key it replaces stops working.
  it("mints a new key into the same Connection and revokes the old one", async () => {
    const { svc, store, keys } = harness();
    const id = await svc.ensureDamConnection();
    await svc.setAgentConnections("agent-1", [id!]);

    await svc.rotateDamConnection(id!);
    const conn = damRows(store.rows)[0]!;
    expect(conn.id).toBe(id);
    expect(conn.inputs[DAM_KEY_INPUT]).toBe("key-2");
    expect(secretOf(store.secrets, conn)?.fields.value).toBe("pk_secret_key-2");
    expect(keys.revoked).toEqual(["key-1"]);
    expect(keys.live).toEqual(new Set(["key-2"]));
    expect(store.grants).toContain(`${id}|agent-1`);
    expect(await svc.getConnection(id!)).toMatchObject({ status: "active" });
  });

  // TEST_SCENARIO: a key the owner revoked in Settings leaves the Connection reading expired rather than active, and rotating it is what puts it back.
  it("reads expired while its key is revoked, and active once rotated", async () => {
    const { svc, keys } = harness();
    const id = await svc.ensureDamConnection();
    expect(await svc.getConnection(id!)).toMatchObject({ status: "active" });

    await keys.keys.revoke("key-1");
    expect(await svc.getConnection(id!)).toMatchObject({ status: "expired" });
    expect((await svc.listConnections()).map((c) => c.status)).toEqual([
      "expired",
    ]);

    await svc.rotateDamConnection(id!);
    expect(await svc.getConnection(id!)).toMatchObject({ status: "active" });
  });

  // TEST_SCENARIO: the old key cannot be revoked after the switch, which must not fail the rotation: the new key already works and the old one is written down for the sweep.
  it("defers a rotation it could not finish revoking", async () => {
    const { svc, store, keys } = harness();
    const id = await svc.ensureDamConnection();
    keys.refuseRevokeWith(new Error("directory down"));
    await svc.rotateDamConnection(id!);
    expect(secretOf(store.secrets, damRows(store.rows)[0]!)?.fields.value).toBe(
      "pk_secret_key-2",
    );
    expect(keys.deferred).toEqual(["key-1"]);
  });

  it("refuses a Connection that is not the install's own", async () => {
    const { svc, store } = harness();
    await store.rows.set("conn-other", {
      id: "conn-other",
      ownerId: "owner",
      templateId: "custom-header",
      name: "Billing",
      inputs: {},
      auth: { kind: "none" },
      contributions: [],
    });
    await expect(svc.rotateDamConnection("conn-other")).rejects.toThrow(
      /only this install's own Connection/i,
    );
  });
});

describe("the install's own host", () => {
  // TEST_SCENARIO: another Connection to the install's own address would share the TLS chain the DAM key is injected on, so its create is refused whatever template it is; the platform's own Connection is not.
  it("is reserved for the platform's Connection", async () => {
    const { svc } = harness();
    await expect(
      svc.createFromTemplate({
        templateId: "custom-header",
        name: "Another door to the install",
        authKind: "header",
        host: "dam.example.com",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
        value: "whatever",
      }),
    ).rejects.toThrow(/this install's own address/);
    expect(await svc.ensureDamConnection()).not.toBeNull();
  });
});

describe("granting the DAM connection", () => {
  it("grants it to the owner's agent", async () => {
    const { svc, store } = harness();
    const id = await svc.ensureDamConnection();
    await svc.setAgentConnections("agent-1", [id!]);
    expect(store.grants).toContain(`${id}|agent-1`);
  });

  it("refuses a connection another owner holds", async () => {
    const { svc } = harness();
    await svc.ensureDamConnection();
    await expect(
      svc.setAgentConnections("agent-1", ["conn-elsewhere"]),
    ).rejects.toThrow(/not owned by caller/);
  });
});

describe("the minted key", () => {
  it("carries every scope a person's key has, and no satellite's", async () => {
    const keys = fakeKeys();
    const port = damKeyPortFor(keys.keys, keys.directory, BRAND);
    expect(await port.mint()).toEqual({
      id: "key-1",
      plaintext: "pk_secret_key-1",
    });
    expect(keys.calls[0]?.scopes).not.toContain("satellites:serve");
    expect(keys.calls[0]?.scopes).toEqual([
      ...AGENT_SCOPES,
      ...CREDENTIAL_SCOPES,
    ]);
  });
});
