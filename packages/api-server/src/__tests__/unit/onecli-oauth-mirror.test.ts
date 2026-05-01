import { describe, it, expect } from "vitest";

import {
  deleteOAuthSecretViaOnecli,
  oauthSecretName,
  upsertOAuthSecretViaOnecli,
} from "../../modules/connections/infrastructure/onecli-oauth-mirror.js";

interface FakeCall {
  path: string;
  method: string;
  body?: unknown;
}

function makeFakeOc(
  responses: Record<string, { ok: boolean; body: unknown; status?: number }>,
) {
  const calls: FakeCall[] = [];
  const client = {
    exchangeToken: async () => "tok",
    getApiKey: async () => "key",
    syncUser: async () => {},
    async onecliFetch(_jwt: string, _sub: string, path: string, init?: RequestInit) {
      const method = init?.method ?? "GET";
      const bodyText = init?.body ? String(init.body) : undefined;
      const body = bodyText ? JSON.parse(bodyText) : undefined;
      calls.push({ path, method, body });
      const key = `${method} ${path}`;
      const match = responses[key] ?? responses[path];
      if (!match) {
        return new Response(JSON.stringify({ error: "not stubbed" }), { status: 500 });
      }
      return new Response(JSON.stringify(match.body), {
        status: match.status ?? (match.ok ? 200 : 500),
      });
    },
  };
  return { client, calls };
}

describe("oauthSecretName", () => {
  it("prefixes with __humr_oauth: so OneCLI can recognize Humr-managed rows", () => {
    expect(oauthSecretName("github")).toBe("__humr_oauth:github");
    expect(oauthSecretName("github-enterprise")).toBe("__humr_oauth:github-enterprise");
  });
});

describe("upsertOAuthSecretViaOnecli", () => {
  it("creates a new generic secret when none exists", async () => {
    const { client, calls } = makeFakeOc({
      "/api/secrets": { ok: true, body: [] },
      "POST /api/secrets": { ok: true, body: { id: "new-id" } },
    });
    await upsertOAuthSecretViaOnecli(client, "jwt", "sub", {
      connection: "github",
      hostPattern: "api.github.com",
      accessToken: "tok-1",
      expiresAt: 9999,
    });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe("/api/secrets");
    expect(post.body).toMatchObject({
      name: "__humr_oauth:github",
      type: "generic",
      value: "tok-1",
      hostPattern: "api.github.com",
      injectionConfig: {
        headerName: "authorization",
        valueFormat: "Bearer {value}",
        expiresAt: 9999,
      },
    });
  });

  it("deletes an existing same-named secret before posting the replacement (upsert)", async () => {
    const { client, calls } = makeFakeOc({
      "/api/secrets": {
        ok: true,
        body: [
          {
            id: "old-id",
            name: "__humr_oauth:github",
            type: "generic",
            hostPattern: "api.github.com",
            injectionConfig: { headerName: "authorization", valueFormat: "Bearer {value}" },
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
      "DELETE /api/secrets/old-id": { ok: true, body: { ok: true } },
      "POST /api/secrets": { ok: true, body: { id: "new-id" } },
    });
    await upsertOAuthSecretViaOnecli(client, "jwt", "sub", {
      connection: "github",
      hostPattern: "api.github.com",
      accessToken: "tok-2",
    });
    const methods = calls.map((c) => c.method);
    expect(methods).toEqual(["GET", "DELETE", "POST"]);
  });

  it("respects an injection override", async () => {
    const { client, calls } = makeFakeOc({
      "/api/secrets": { ok: true, body: [] },
      "POST /api/secrets": { ok: true, body: { id: "new-id" } },
    });
    await upsertOAuthSecretViaOnecli(client, "jwt", "sub", {
      connection: "github",
      hostPattern: "api.github.com",
      accessToken: "tok-1",
      injection: { headerName: "x-custom", valueFormat: "Token {value}" },
    });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({
      injectionConfig: { headerName: "x-custom", valueFormat: "Token {value}" },
    });
  });
});

describe("deleteOAuthSecretViaOnecli", () => {
  it("deletes the matching row by name", async () => {
    const { client, calls } = makeFakeOc({
      "/api/secrets": {
        ok: true,
        body: [
          { id: "id-1", name: "__humr_oauth:github", type: "generic", hostPattern: "api.github.com", injectionConfig: null, createdAt: "" },
        ],
      },
      "DELETE /api/secrets/id-1": { ok: true, body: { ok: true } },
    });
    await deleteOAuthSecretViaOnecli(client, "jwt", "sub", "github");
    expect(calls.find((c) => c.method === "DELETE")?.path).toBe("/api/secrets/id-1");
  });

  it("is a no-op when there's no matching row", async () => {
    const { client, calls } = makeFakeOc({
      "/api/secrets": { ok: true, body: [] },
    });
    await deleteOAuthSecretViaOnecli(client, "jwt", "sub", "github");
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });
});
