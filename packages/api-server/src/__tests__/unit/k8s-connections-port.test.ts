import { describe, it, expect } from "vitest";
import type * as k8s from "@kubernetes/client-node";

import {
  connectionSecretName,
  createK8sConnectionsPort,
  listAllConnectionWorkItems,
  markConnectionExpired,
  readConnectionForRefresh,
  writeRefreshedTokens,
} from "../../modules/connections/infrastructure/k8s-connections-port.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

function fakeClient() {
  const store = new Map<string, k8s.V1Secret>();
  // Round-trip stringData → data so reads see what kubelet would surface (the
  // real K8s API persists `stringData` as base64-encoded `data`). The port
  // reads via decodeData() which expects base64.
  function persist(body: k8s.V1Secret): k8s.V1Secret {
    if (body.stringData) {
      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.stringData)) {
        data[k] = Buffer.from(v).toString("base64");
      }
      return { ...body, data, stringData: undefined };
    }
    return body;
  }
  const client: K8sClient = {
    namespace: "default",
    listConfigMaps: async () => [],
    getConfigMap: async () => null,
    createConfigMap: async (b) => b,
    replaceConfigMap: async (_n, b) => b,
    patchConfigMap: async () => undefined,
    deleteConfigMap: async () => undefined,
    listSecrets: async (selector: string) => {
      const filters = selector.split(",").map((p) => p.split("="));
      return Array.from(store.values()).filter((s) =>
        filters.every(([k, v]) => s.metadata?.labels?.[k!] === v),
      );
    },
    getSecret: async (n) => store.get(n) ?? null,
    createSecret: async (body) => {
      const persisted = persist(body);
      store.set(body.metadata!.name!, persisted);
      return persisted;
    },
    replaceSecret: async (n, body) => {
      const persisted = persist(body);
      store.set(n, persisted);
      return persisted;
    },
    deleteSecret: async (n) => {
      store.delete(n);
    },
    listPods: async () => [],
    getPod: async () => null,
    patchPod: async () => undefined,
    deletePod: async () => false,
    listPVCs: async () => [],
    deletePVC: async () => undefined,
  };
  return { client, store };
}

const SAMPLE_METADATA = {
  hostPattern: "mcp.example.com",
  headerName: "Authorization",
  valueFormat: "Bearer {value}",
  tokenUrl: "https://mcp.example.com/oauth/token",
  clientId: "client-123",
  clientSecret: "client-secret",
  grantType: "authorization_code" as const,
};

describe("connectionSecretName", () => {
  it("hashes both owner and connection so the name fits RFC 1123", () => {
    const name = connectionSecretName("uuid-with-Mixed-Case", "mcp.example.com");
    expect(name).toMatch(/^humr-conn-[a-f0-9]{16}-[a-f0-9]{16}$/);
  });

  it("is stable for the same (owner, connection)", () => {
    const a = connectionSecretName("owner-1", "mcp.example.com");
    const b = connectionSecretName("owner-1", "mcp.example.com");
    expect(a).toBe(b);
  });

  it("differentiates same connection across owners", () => {
    const a = connectionSecretName("owner-1", "mcp.example.com");
    const b = connectionSecretName("owner-2", "mcp.example.com");
    expect(a).not.toBe(b);
  });
});

describe("K8sConnectionsPort.upsertConnection", () => {
  it("writes labels, annotations, and the SDS-formatted access token", async () => {
    const { client, store } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "tok-1", refreshToken: "ref-1", expiresAt: 9999 },
      metadata: SAMPLE_METADATA,
    });

    const name = connectionSecretName("owner-1", "mcp.example.com");
    const secret = store.get(name);
    expect(secret).toBeDefined();
    expect(secret!.metadata?.labels?.["humr.ai/owner"]).toBe("owner-1");
    expect(secret!.metadata?.labels?.["humr.ai/managed-by"]).toBe("api-server");
    expect(secret!.metadata?.labels?.["humr.ai/secret-type"]).toBe("connection");
    expect(secret!.metadata?.labels?.["humr.ai/connection"]).toBe(
      "mcp.example.com",
    );
    expect(secret!.metadata?.annotations?.["humr.ai/host-pattern"]).toBe(
      "mcp.example.com",
    );
    expect(secret!.metadata?.annotations?.["humr.ai/expires-at"]).toBe("9999");
    expect(secret!.metadata?.annotations?.["humr.ai/grant-type"]).toBe(
      "authorization_code",
    );
    expect(secret!.metadata?.annotations?.["humr.ai/connection-status"]).toBe(
      "active",
    );
    // The access token reaches the sidecar via sds.yaml — header prefix baked in.
    const sds = Buffer.from(secret!.data!["sds.yaml"]!, "base64").toString();
    expect(sds).toContain('inline_string: "Bearer tok-1"');
    // The refresh-loop reads the raw token + refresh token + client id directly.
    expect(Buffer.from(secret!.data!["raw_access_token"]!, "base64").toString()).toBe("tok-1");
    expect(Buffer.from(secret!.data!["refresh_token"]!, "base64").toString()).toBe("ref-1");
    expect(Buffer.from(secret!.data!["client_id"]!, "base64").toString()).toBe("client-123");
  });

  it("preserves connectedAt across upserts (so re-auth doesn't reset the timestamp)", async () => {
    const { client, store } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "first", expiresAt: 1 },
      metadata: SAMPLE_METADATA,
    });
    const name = connectionSecretName("owner-1", "mcp.example.com");
    const firstConnectedAt = store.get(name)!.metadata!.annotations!["humr.ai/connected-at"];

    await new Promise((r) => setTimeout(r, 5));
    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "second", expiresAt: 2 },
      metadata: SAMPLE_METADATA,
    });
    expect(store.get(name)!.metadata!.annotations!["humr.ai/connected-at"]).toBe(firstConnectedAt);
  });
});

describe("K8sConnectionsPort.listConnections", () => {
  it("lists only this owner's connections", async () => {
    const { client } = fakeClient();
    const a = createK8sConnectionsPort(client, "owner-a");
    const b = createK8sConnectionsPort(client, "owner-b");

    await a.upsertConnection({
      connection: "x.example.com",
      tokens: { accessToken: "t", expiresAt: 100 },
      metadata: { ...SAMPLE_METADATA, hostPattern: "x.example.com" },
    });
    await b.upsertConnection({
      connection: "y.example.com",
      tokens: { accessToken: "t", expiresAt: 200 },
      metadata: { ...SAMPLE_METADATA, hostPattern: "y.example.com" },
    });

    const aList = await a.listConnections();
    const bList = await b.listConnections();
    expect(aList.map((c) => c.connection)).toEqual(["x.example.com"]);
    expect(bList.map((c) => c.connection)).toEqual(["y.example.com"]);
  });

  it("surfaces status from the connection-status annotation", async () => {
    const { client } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "t", refreshToken: "r", expiresAt: 1 },
      metadata: SAMPLE_METADATA,
    });
    const name = connectionSecretName("owner-1", "mcp.example.com");
    await markConnectionExpired(client, name);

    const list = await port.listConnections();
    expect(list[0]!.status).toBe("expired");
  });
});

describe("K8sConnectionsPort.getConnection", () => {
  it("round-trips access token, refresh token, client id, and metadata", async () => {
    const { client } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "tok", refreshToken: "ref", expiresAt: 12345 },
      metadata: SAMPLE_METADATA,
    });

    const got = await port.getConnection("mcp.example.com");
    expect(got).not.toBeNull();
    expect(got!.tokens.accessToken).toBe("tok");
    expect(got!.tokens.refreshToken).toBe("ref");
    expect(got!.tokens.expiresAt).toBe(12345);
    expect(got!.metadata.tokenUrl).toBe(SAMPLE_METADATA.tokenUrl);
    expect(got!.metadata.clientId).toBe("client-123");
    expect(got!.metadata.clientSecret).toBe("client-secret");
    expect(got!.metadata.grantType).toBe("authorization_code");
    expect(got!.status).toBe("active");
  });

  it("returns null when an owner reads another owner's Secret name", async () => {
    const { client } = fakeClient();
    const a = createK8sConnectionsPort(client, "owner-a");
    const b = createK8sConnectionsPort(client, "owner-b");

    await a.upsertConnection({
      connection: "shared.example.com",
      tokens: { accessToken: "t" },
      metadata: { ...SAMPLE_METADATA, hostPattern: "shared.example.com" },
    });
    expect(await b.getConnection("shared.example.com")).toBeNull();
  });
});

describe("listAllConnectionWorkItems / writeRefreshedTokens / markConnectionExpired", () => {
  it("walks every owner's connection Secrets", async () => {
    const { client } = fakeClient();
    const a = createK8sConnectionsPort(client, "owner-a");
    const b = createK8sConnectionsPort(client, "owner-b");

    await a.upsertConnection({
      connection: "x.example.com",
      tokens: { accessToken: "t", refreshToken: "r", expiresAt: 100 },
      metadata: { ...SAMPLE_METADATA, hostPattern: "x.example.com" },
    });
    await b.upsertConnection({
      connection: "y.example.com",
      tokens: { accessToken: "t", refreshToken: "r", expiresAt: 200 },
      metadata: { ...SAMPLE_METADATA, hostPattern: "y.example.com" },
    });

    const items = await listAllConnectionWorkItems(client);
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.owner))).toEqual(new Set(["owner-a", "owner-b"]));
  });

  it("writeRefreshedTokens replaces token data while keeping host metadata stable", async () => {
    const { client } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "old", refreshToken: "ref-old", expiresAt: 100 },
      metadata: SAMPLE_METADATA,
    });
    const name = connectionSecretName("owner-1", "mcp.example.com");
    const loaded = await readConnectionForRefresh(client, name);
    expect(loaded).not.toBeNull();

    await writeRefreshedTokens(
      client,
      name,
      { accessToken: "new", refreshToken: "ref-new", expiresAt: 200 },
      loaded!.record.metadata,
    );

    const after = await port.getConnection("mcp.example.com");
    expect(after!.tokens.accessToken).toBe("new");
    expect(after!.tokens.refreshToken).toBe("ref-new");
    expect(after!.tokens.expiresAt).toBe(200);
    expect(after!.metadata.hostPattern).toBe("mcp.example.com");
    expect(after!.status).toBe("active");
  });

  it("markConnectionExpired flips the status annotation", async () => {
    const { client } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "t", refreshToken: "r", expiresAt: 100 },
      metadata: SAMPLE_METADATA,
    });
    await markConnectionExpired(client, connectionSecretName("owner-1", "mcp.example.com"));
    const items = await listAllConnectionWorkItems(client);
    expect(items[0]!.status).toBe("expired");
  });
});
