import { describe, it, expect, vi } from "vitest";
import type * as k8s from "@kubernetes/client-node";

import {
  connectionSecretName,
  createK8sConnectionsPort,
} from "../../modules/connections/infrastructure/k8s-connections-port.js";
import { createOAuthRefreshService } from "../../modules/connections/services/oauth-refresh-service.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

function fakeClient() {
  const store = new Map<string, k8s.V1Secret>();
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
  grantType: "authorization_code" as const,
};

function decode(secret: k8s.V1Secret, key: string): string {
  return Buffer.from(secret.data![key]!, "base64").toString();
}

describe("oauth-refresh-service", () => {
  it("refreshes tokens whose expiry is within the skew window", async () => {
    const { client, store } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    const NOW_MS = 1_700_000_000_000;
    // expires in 60 seconds — inside the default 5-min skew window.
    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "old", refreshToken: "ref-old", expiresAt: NOW_MS / 1000 + 60 },
      metadata: SAMPLE_METADATA,
    });

    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-ref",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const svc = createOAuthRefreshService({
      k8sClient: client,
      fetchImpl,
      now: () => NOW_MS,
      log: () => {},
    });
    await svc.tick();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(SAMPLE_METADATA.tokenUrl);
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("ref-old");
    expect(body.get("client_id")).toBe("client-123");

    const after = store.get(connectionSecretName("owner-1", "mcp.example.com"))!;
    expect(decode(after, "raw_access_token")).toBe("new-access");
    expect(decode(after, "refresh_token")).toBe("new-ref");
    expect(after.metadata!.annotations!["humr.ai/connection-status"]).toBe("active");
    // expiresAt == now + 3600s
    expect(after.metadata!.annotations!["humr.ai/expires-at"]).toBe(
      String(Math.floor(NOW_MS / 1000) + 3600),
    );
  });

  it("skips tokens that aren't due yet", async () => {
    const { client } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    const NOW_MS = 1_700_000_000_000;
    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "tok", refreshToken: "ref", expiresAt: NOW_MS / 1000 + 7200 },
      metadata: SAMPLE_METADATA,
    });

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const svc = createOAuthRefreshService({
      k8sClient: client,
      fetchImpl,
      now: () => NOW_MS,
      log: () => {},
    });
    await svc.tick();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips client_credentials grants — Envoy refreshes those natively", async () => {
    const { client } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    const NOW_MS = 1_700_000_000_000;
    await port.upsertConnection({
      connection: "svc.example.com",
      tokens: { accessToken: "tok", refreshToken: "ref", expiresAt: NOW_MS / 1000 + 30 },
      metadata: { ...SAMPLE_METADATA, grantType: "client_credentials", hostPattern: "svc.example.com" },
    });

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const svc = createOAuthRefreshService({
      k8sClient: client,
      fetchImpl,
      now: () => NOW_MS,
      log: () => {},
    });
    await svc.tick();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("marks connections expired on invalid_grant (revoked refresh token)", async () => {
    const { client, store } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    const NOW_MS = 1_700_000_000_000;
    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "old", refreshToken: "ref-old", expiresAt: NOW_MS / 1000 + 30 },
      metadata: SAMPLE_METADATA,
    });

    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: "invalid_grant", error_description: "token revoked" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const svc = createOAuthRefreshService({
      k8sClient: client,
      fetchImpl,
      now: () => NOW_MS,
      log: () => {},
    });
    await svc.tick();

    const after = store.get(connectionSecretName("owner-1", "mcp.example.com"))!;
    expect(after.metadata!.annotations!["humr.ai/connection-status"]).toBe("expired");
    // Original token is unchanged — only the status flipped.
    expect(decode(after, "raw_access_token")).toBe("old");
  });

  it("backs off on transient failures and retries after the backoff elapses", async () => {
    const { client } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    let nowMs = 1_700_000_000_000;
    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "old", refreshToken: "ref-old", expiresAt: nowMs / 1000 + 30 },
      metadata: SAMPLE_METADATA,
    });

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream broke", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "new", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ) as unknown as typeof fetch;

    const svc = createOAuthRefreshService({
      k8sClient: client,
      fetchImpl,
      now: () => nowMs,
      log: () => {},
      config: { baseBackoffMs: 1000, maxBackoffMs: 10_000 },
    });

    await svc.tick();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Tick again immediately — should be in backoff.
    await svc.tick();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Advance past the backoff window.
    nowMs += 1500;
    await svc.tick();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("skips items already marked expired (no point retrying with a dead refresh token)", async () => {
    const { client } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    const NOW_MS = 1_700_000_000_000;
    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "tok", refreshToken: "ref", expiresAt: NOW_MS / 1000 + 30 },
      metadata: SAMPLE_METADATA,
    });
    const { markConnectionExpired } = await import(
      "../../modules/connections/infrastructure/k8s-connections-port.js"
    );
    await markConnectionExpired(client, connectionSecretName("owner-1", "mcp.example.com"));

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const svc = createOAuthRefreshService({
      k8sClient: client,
      fetchImpl,
      now: () => NOW_MS,
      log: () => {},
    });
    await svc.tick();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preserves the existing refresh token when the response omits one (provider doesn't rotate)", async () => {
    const { client, store } = fakeClient();
    const port = createK8sConnectionsPort(client, "owner-1");

    const NOW_MS = 1_700_000_000_000;
    await port.upsertConnection({
      connection: "mcp.example.com",
      tokens: { accessToken: "old", refreshToken: "ref-keep", expiresAt: NOW_MS / 1000 + 30 },
      metadata: SAMPLE_METADATA,
    });

    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: "new", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const svc = createOAuthRefreshService({
      k8sClient: client,
      fetchImpl,
      now: () => NOW_MS,
      log: () => {},
    });
    await svc.tick();

    const after = store.get(connectionSecretName("owner-1", "mcp.example.com"))!;
    expect(decode(after, "refresh_token")).toBe("ref-keep");
    expect(decode(after, "raw_access_token")).toBe("new");
  });
});
