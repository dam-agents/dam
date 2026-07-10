import { describe, it, expect } from "vitest";
import {
  createOAuthEngine,
  type OAuthProvider,
} from "../../modules/connections/infrastructure/oauth-engine.js";

const NOW_MS = 1_800_000_000_000;

interface RecordedCall {
  url: string;
  body: URLSearchParams;
  accept: string | undefined;
}

function makeEngine(respond: (call: RecordedCall) => Response) {
  const calls: RecordedCall[] = [];
  const engine = createOAuthEngine({
    now: () => NOW_MS,
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const call: RecordedCall = {
        url: String(url),
        body: new URLSearchParams(String(init?.body)),
        accept: (init?.headers as Record<string, string>)?.["Accept"],
      };
      calls.push(call);
      return respond(call);
    }) as typeof fetch,
  });
  return { engine, calls };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function provider(overrides: Partial<OAuthProvider> = {}): OAuthProvider {
  return {
    id: "connection:conn-1:custom-client-credentials",
    tokenEndpoint: "https://auth.example.com/token",
    clientId: "cid",
    clientSecret: "csecret",
    scopes: ["read", "write"],
    ...overrides,
  };
}

describe("oauth engine client_credentials grant", () => {
  it("posts grant, client id/secret, joined scopes, and audience", async () => {
    const { engine, calls } = makeEngine(() =>
      jsonResponse({ access_token: "tok", expires_in: 120 }),
    );
    await engine.clientCredentials({
      provider: provider(),
      audience: "https://api.example.com",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://auth.example.com/token");
    expect(Object.fromEntries(calls[0].body)).toEqual({
      grant_type: "client_credentials",
      client_id: "cid",
      client_secret: "csecret",
      scope: "read write",
      audience: "https://api.example.com",
    });
  });

  it("omits scope and audience when unset", async () => {
    const { engine, calls } = makeEngine(() =>
      jsonResponse({ access_token: "tok" }),
    );
    await engine.clientCredentials({ provider: provider({ scopes: [] }) });
    expect(calls[0].body.has("scope")).toBe(false);
    expect(calls[0].body.has("audience")).toBe(false);
  });

  it("computes expiresAt from expires_in", async () => {
    const { engine } = makeEngine(() =>
      jsonResponse({ access_token: "tok", expires_in: 120 }),
    );
    const tokens = await engine.clientCredentials({ provider: provider() });
    expect(tokens.accessToken).toBe("tok");
    expect(tokens.expiresAt).toBe(Math.floor(NOW_MS / 1000) + 120);
  });

  it("leaves expiresAt unset when the provider returns no expires_in", async () => {
    const { engine } = makeEngine(() => jsonResponse({ access_token: "tok" }));
    const tokens = await engine.clientCredentials({ provider: provider() });
    expect(tokens.expiresAt).toBeUndefined();
  });

  it("parses a form-encoded token response", async () => {
    const { engine } = makeEngine(
      () => new Response("access_token=tok&expires_in=60", { status: 200 }),
    );
    const tokens = await engine.clientCredentials({ provider: provider() });
    expect(tokens.accessToken).toBe("tok");
    expect(tokens.expiresAt).toBe(Math.floor(NOW_MS / 1000) + 60);
  });

  it("surfaces a provider error payload as a thrown error", async () => {
    const { engine } = makeEngine(() =>
      jsonResponse({ error: "invalid_client", error_description: "nope" }),
    );
    await expect(
      engine.clientCredentials({ provider: provider() }),
    ).rejects.toThrow(/invalid_client: nope/);
  });

  it("surfaces a non-2xx response as a thrown error", async () => {
    const { engine } = makeEngine(
      () => new Response("unauthorized", { status: 401 }),
    );
    await expect(
      engine.clientCredentials({ provider: provider() }),
    ).rejects.toThrow(/401/);
  });

  it("requires a client secret before dialing the endpoint", async () => {
    const { engine, calls } = makeEngine(() =>
      jsonResponse({ access_token: "tok" }),
    );
    await expect(
      engine.clientCredentials({
        provider: provider({ clientSecret: undefined }),
      }),
    ).rejects.toThrow(/client secret/);
    expect(calls).toHaveLength(0);
  });

  it("start() rejects a provider without an authorizationUrl", () => {
    const { engine } = makeEngine(() => jsonResponse({ access_token: "tok" }));
    expect(() =>
      engine.start({
        provider: provider(),
        redirectUri: "https://app.example/cb",
        ctx: {},
      }),
    ).toThrow(/authorizationUrl/);
  });
});
