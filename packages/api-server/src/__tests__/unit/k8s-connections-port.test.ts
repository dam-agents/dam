import { describe, it, expect } from "vitest";
import type * as k8s from "@kubernetes/client-node";

import {
  connectionSecretName,
  CONNECTION_SCHEMA_VERSION,
  createK8sConnectionsPort,
  listAllConnectionWorkItems,
  markConnectionExpired,
  readConnectionForRefresh,
  sdsFileKeyForHost,
  writeRefreshedTokens,
  type ConnectionMetadata,
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

// Simplest legal ConnectionMetadata — single host, default scheme.
const SAMPLE_METADATA: ConnectionMetadata = {
  hosts: [{ host: "mcp.example.com" }],
  tokenUrl: "https://mcp.example.com/oauth/token",
  clientId: "client-123",
  clientSecret: "client-secret",
  grantType: "authorization_code",
};

function decode(secret: k8s.V1Secret, key: string): string {
  return Buffer.from(secret.data![key]!, "base64").toString();
}

// Issue #219: the file key must agree byte-for-byte with the controller's
// `sdsFileKeyForHost`. The Go side has a mirroring test pinning these.
describe("sdsFileKeyForHost", () => {
  it.each([
    ["api.github.com", "host-01892413.sds.yaml"],
    ["github.com", "host-c2208abd.sds.yaml"],
    ["raw.githubusercontent.com", "host-3cf88e0a.sds.yaml"],
  ])("sdsFileKeyForHost(%s) === %s", (host, expected) => {
    expect(sdsFileKeyForHost(host)).toBe(expected);
  });
});

describe("connectionSecretName", () => {
  it("hashes both owner and connection so the name fits RFC 1123", () => {
    const name = connectionSecretName("uuid-with-Mixed-Case", "mcp.example.com");
    expect(name).toMatch(/^platform-conn-[a-f0-9]{16}-[a-f0-9]{16}$/);
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

describe("K8sConnectionsPort.upsertConnection — single-host", () => {
  it("writes one SDS file under host-<sha>.sds.yaml and the structured hosts annotation", async () => {
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
    const ann = secret!.metadata!.annotations!;
    expect(secret!.metadata?.labels?.["agent-platform.ai/connection"]).toBe(
      "mcp.example.com",
    );
    // Schema version pinned — future bumps drive migrations.
    expect(ann["agent-platform.ai/schema-version"]).toBe(CONNECTION_SCHEMA_VERSION);
    expect(ann["agent-platform.ai/host-patterns"]).toBe("mcp.example.com");
    expect(JSON.parse(ann["agent-platform.ai/injection-hosts"]!)).toEqual([
      { host: "mcp.example.com" },
    ]);
    expect(ann["agent-platform.ai/expires-at"]).toBe("9999");
    expect(ann["agent-platform.ai/connection-status"]).toBe("active");
    // Per-host SDS file, no generic `sds.yaml`.
    const fileKey = sdsFileKeyForHost("mcp.example.com");
    expect(decode(secret!, fileKey)).toContain('inline_string: "Bearer tok-1"');
    expect(decode(secret!, "raw_access_token")).toBe("tok-1");
    expect(decode(secret!, "refresh_token")).toBe("ref-1");
    expect(decode(secret!, "client_id")).toBe("client-123");
    expect(secret!.data!["sds.yaml"]).toBeUndefined();
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
    const firstConnectedAt = store.get(name)!.metadata!.annotations!["agent-platform.ai/connected-at"];

    await new Promise((r) => setTimeout(r, 5));
    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "second", expiresAt: 2 },
      metadata: SAMPLE_METADATA,
    });
    expect(store.get(name)!.metadata!.annotations!["agent-platform.ai/connected-at"]).toBe(firstConnectedAt);
  });

  it("rejects metadata with an empty hosts list (caller bug)", async () => {
    const { client } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");
    await expect(
      port.upsertConnection({
        connection: "broken",
        tokens: { accessToken: "t" },
        metadata: { ...SAMPLE_METADATA, hosts: [] },
      }),
    ).rejects.toThrow(/hosts is empty/);
  });
});

// Issue #219: one OAuth token, three hosts, three auth schemes. These
// pin both the K8s Secret shape and the refresh-loop interactions.
describe("K8sConnectionsPort — multi-host (issue #219)", () => {
  const GITHUB_METADATA: ConnectionMetadata = {
    hosts: [
      { host: "api.github.com" },
      {
        host: "github.com",
        valueFormat: "Basic {value}",
        encoding: "basic-x-access-token",
      },
      { host: "raw.githubusercontent.com" },
    ],
    tokenUrl: "https://github.com/login/oauth/access_token",
    clientId: "github-client",
    clientSecret: "github-secret",
    grantType: "authorization_code",
  };

  it("writes one SDS file per host inside the same Secret", async () => {
    const { client, store } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    await port.upsertConnection({
      connection: "github",
      tokens: { accessToken: "tok-1", refreshToken: "ref-1", expiresAt: 1000 },
      metadata: GITHUB_METADATA,
    });

    const name = connectionSecretName("owner-1", "github");
    const secret = store.get(name)!;
    // One Secret, one mount, three chains.
    expect(Array.from(store.values())).toHaveLength(1);
    expect(secret.metadata?.annotations?.["agent-platform.ai/host-patterns"]).toBe(
      "api.github.com,github.com,raw.githubusercontent.com",
    );
    const parsed = JSON.parse(
      secret.metadata!.annotations!["agent-platform.ai/injection-hosts"]!,
    );
    expect(parsed).toEqual(GITHUB_METADATA.hosts);

    const apiSds = decode(secret, sdsFileKeyForHost("api.github.com"));
    expect(apiSds).toContain('inline_string: "Bearer tok-1"');

    // github.com: HTTP Basic, username `x-access-token`. Makes `git clone` work.
    const wwwSds = decode(secret, sdsFileKeyForHost("github.com"));
    const expectedB64 = Buffer.from("x-access-token:tok-1", "utf8").toString("base64");
    expect(wwwSds).toContain(`inline_string: "Basic ${expectedB64}"`);

    const rawSds = decode(secret, sdsFileKeyForHost("raw.githubusercontent.com"));
    expect(rawSds).toContain('inline_string: "Bearer tok-1"');
  });

  it("getConnection round-trips the full hosts list (no information loss)", async () => {
    const { client } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    await port.upsertConnection({
      connection: "github",
      tokens: { accessToken: "tok", refreshToken: "ref", expiresAt: 12345 },
      metadata: GITHUB_METADATA,
    });

    const got = await port.getConnection("github");
    expect(got).not.toBeNull();
    expect(got!.metadata.hosts).toEqual(GITHUB_METADATA.hosts);
    expect(got!.tokens.accessToken).toBe("tok");
    expect(got!.tokens.refreshToken).toBe("ref");
    expect(got!.metadata.clientId).toBe("github-client");
    expect(got!.metadata.clientSecret).toBe("github-secret");
  });

  it("listConnections surfaces the host list (no twins, no descriptor lookup needed)", async () => {
    const { client } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    await port.upsertConnection({
      connection: "github",
      tokens: { accessToken: "tok-1" },
      metadata: GITHUB_METADATA,
    });

    const list = await port.listConnections();
    expect(list).toHaveLength(1);
    expect(list[0]!.connection).toBe("github");
    expect(list[0]!.hosts).toEqual([
      "api.github.com",
      "github.com",
      "raw.githubusercontent.com",
    ]);
  });

  it("re-upsert with fewer hosts removes stale SDS files (no leftovers)", async () => {
    const { client, store } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    await port.upsertConnection({
      connection: "github",
      tokens: { accessToken: "tok-1" },
      metadata: GITHUB_METADATA,
    });
    const name = connectionSecretName("owner-1", "github");
    expect(store.get(name)!.data![sdsFileKeyForHost("github.com")]).toBeDefined();

    // Reconnect with one host — dropped hosts' SDS files must go.
    await port.upsertConnection({
      connection: "github",
      tokens: { accessToken: "tok-1" },
      metadata: { ...GITHUB_METADATA, hosts: [{ host: "api.github.com" }] },
    });
    const after = store.get(name)!;
    expect(after.data![sdsFileKeyForHost("api.github.com")]).toBeDefined();
    expect(after.data![sdsFileKeyForHost("github.com")]).toBeUndefined();
    expect(after.data![sdsFileKeyForHost("raw.githubusercontent.com")]).toBeUndefined();
  });

  it("writeRefreshedTokens re-renders every host's SDS file from the new token", async () => {
    const { client, store } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    await port.upsertConnection({
      connection: "github",
      tokens: { accessToken: "old", refreshToken: "ref-old", expiresAt: 100 },
      metadata: GITHUB_METADATA,
    });
    const name = connectionSecretName("owner-1", "github");
    const loaded = await readConnectionForRefresh(client, name);
    expect(loaded).not.toBeNull();

    await writeRefreshedTokens(
      client,
      name,
      { accessToken: "rotated", refreshToken: "ref-new", expiresAt: 200 },
      loaded!.record.metadata,
    );

    const after = store.get(name)!;
    const apiSds = decode(after, sdsFileKeyForHost("api.github.com"));
    expect(apiSds).toContain('inline_string: "Bearer rotated"');
    const wwwSds = decode(after, sdsFileKeyForHost("github.com"));
    const expectedB64 = Buffer.from("x-access-token:rotated", "utf8").toString("base64");
    expect(wwwSds).toContain(`inline_string: "Basic ${expectedB64}"`);
    const rawSds = decode(after, sdsFileKeyForHost("raw.githubusercontent.com"));
    expect(rawSds).toContain('inline_string: "Bearer rotated"');
    expect(decode(after, "refresh_token")).toBe("ref-new");
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
      metadata: { ...SAMPLE_METADATA, hosts: [{ host: "x.example.com" }] },
    });
    await b.upsertConnection({
      connection: "y.example.com",
      tokens: { accessToken: "t", expiresAt: 200 },
      metadata: { ...SAMPLE_METADATA, hosts: [{ host: "y.example.com" }] },
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
    expect(got!.metadata.hosts).toEqual([{ host: "mcp.example.com" }]);
    expect(got!.status).toBe("active");
  });

  it("returns null when an owner reads another owner's Secret name", async () => {
    const { client } = fakeClient();
    const a = createK8sConnectionsPort(client, "owner-a");
    const b = createK8sConnectionsPort(client, "owner-b");

    await a.upsertConnection({
      connection: "shared.example.com",
      tokens: { accessToken: "t" },
      metadata: { ...SAMPLE_METADATA, hosts: [{ host: "shared.example.com" }] },
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
      metadata: { ...SAMPLE_METADATA, hosts: [{ host: "x.example.com" }] },
    });
    await b.upsertConnection({
      connection: "y.example.com",
      tokens: { accessToken: "t", refreshToken: "r", expiresAt: 200 },
      metadata: { ...SAMPLE_METADATA, hosts: [{ host: "y.example.com" }] },
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
    expect(after!.metadata.hosts).toEqual([{ host: "mcp.example.com" }]);
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
