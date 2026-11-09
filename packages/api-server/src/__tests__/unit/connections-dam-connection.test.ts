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
  let minted = 0;
  const keys: ApiKeysService = {
    list: async () => [],
    create: async (input) => {
      calls.push({
        name: input.name,
        scopes: input.scopes,
        agentIds: input.agentIds,
      });
      const id = `key-${++minted}`;
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
    revoke: async (id) => void revoked.push(id),
  };
  return { keys, calls, revoked };
}

function harness(baseUrl = BASE_URL) {
  const store = newConnectionsStore();
  const keys = fakeKeys();
  const { svc } = serviceHarness({
    templates: templatesFor(baseUrl),
    store,
    brandName: BRAND,
    damKey: damKeyPortFor(keys.keys, BRAND),
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

  it("is one per owner, and mints nothing while one is held", async () => {
    const { svc, store, keys } = harness();
    const first = await svc.ensureDamConnection();
    const second = await svc.ensureDamConnection();
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
    const port = damKeyPortFor(keys.keys, BRAND);
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
