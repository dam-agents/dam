import { describe, it, expect, vi } from "vitest";

import {
  createOAuthEngine,
  type OAuthFlowProvider,
  type OAuthFlowMetadata,
} from "../../modules/connections/infrastructure/oauth-engine.js";

const PROVIDER: OAuthFlowProvider = {
  id: "github",
  authorizationUrl: "https://github.com/login/oauth/authorize",
  tokenEndpoint: "https://github.com/login/oauth/access_token",
  clientId: "client-1",
  clientSecret: "secret-1",
  scopes: ["repo", "read:user"],
  tokenEndpointAcceptJson: true,
};

const FLOW: OAuthFlowMetadata = {
  connectionKey: "github",
  hostPattern: "api.github.com",
};

describe("oauth-engine.start", () => {
  it("builds an authorize URL with PKCE + scopes + state", () => {
    const engine = createOAuthEngine();
    const { authUrl, state } = engine.start({
      provider: PROVIDER,
      flow: FLOW,
      redirectUri: "https://app.example/api/oauth/callback",
      userJwt: "jwt",
      userSub: "sub-1",
    });
    const url = new URL(authUrl);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/api/oauth/callback");
    expect(url.searchParams.get("scope")).toBe("repo read:user");
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(state).toMatch(/^[a-f0-9]{32}$/);
  });

  it("appends extraAuthParams verbatim", () => {
    const engine = createOAuthEngine();
    const { authUrl } = engine.start({
      provider: { ...PROVIDER, extraAuthParams: { allow_signup: "false" } },
      flow: FLOW,
      redirectUri: "https://app.example/cb",
      userJwt: "jwt",
      userSub: "sub-1",
    });
    expect(new URL(authUrl).searchParams.get("allow_signup")).toBe("false");
  });

  it("consume() returns the pending flow exactly once", () => {
    const engine = createOAuthEngine();
    const { state } = engine.start({
      provider: PROVIDER,
      flow: FLOW,
      redirectUri: "https://app.example/cb",
      userJwt: "jwt",
      userSub: "sub-1",
    });
    const first = engine.consume(state);
    expect(first).not.toBeNull();
    expect(engine.consume(state)).toBeNull();
  });
});

describe("oauth-engine.exchange", () => {
  it("posts the right grant_type + code + verifier and returns the token set", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "tok",
          refresh_token: "ref",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;
    const NOW_MS = 1_700_000_000_000;
    const engine = createOAuthEngine({ fetchImpl, now: () => NOW_MS });
    const { state } = engine.start({
      provider: PROVIDER,
      flow: FLOW,
      redirectUri: "https://app.example/cb",
      userJwt: "jwt",
      userSub: "sub-1",
    });
    const pending = engine.consume(state)!;

    const tokens = await engine.exchange(pending, "auth-code");

    expect(tokens.accessToken).toBe("tok");
    expect(tokens.refreshToken).toBe("ref");
    expect(tokens.expiresAt).toBe(Math.floor(NOW_MS / 1000) + 3600);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(PROVIDER.tokenEndpoint);
    const init1 = init as RequestInit;
    expect((init1.headers as Record<string, string>)["Accept"]).toBe("application/json");
    const body = (init1.body as URLSearchParams);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("client_secret")).toBe("secret-1");
    expect(body.get("code_verifier")).toBe(pending.codeVerifier);
  });

  it("falls back to form-encoded parsing when the token endpoint returns x-www-form-urlencoded", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("access_token=tok&token_type=bearer&scope=repo", {
        status: 200,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    ) as unknown as typeof fetch;
    const engine = createOAuthEngine({ fetchImpl, now: () => 0 });
    const { state } = engine.start({
      provider: { ...PROVIDER, tokenEndpointAcceptJson: false },
      flow: FLOW,
      redirectUri: "https://app.example/cb",
      userJwt: "jwt",
      userSub: "sub-1",
    });
    const pending = engine.consume(state)!;
    const tokens = await engine.exchange(pending, "code");
    expect(tokens.accessToken).toBe("tok");
    expect(tokens.refreshToken).toBeUndefined();
    expect(tokens.expiresAt).toBeUndefined();
  });

  it("throws when the provider returns 200 with an OAuth error body (GitHub shape)", async () => {
    // GitHub returns HTTP 200 + JSON `{error, error_description}` on auth
    // failures (bad client_secret, code already consumed, redirect-URI
    // mismatch, …). The engine has to surface that as a thrown error so
    // downstream code doesn't write `accessToken: undefined` to OneCLI.
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: "bad_verification_code",
          error_description: "The code passed is incorrect or expired.",
          error_uri: "https://docs.github.com/...",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;
    const engine = createOAuthEngine({ fetchImpl, now: () => 0 });
    const { state } = engine.start({
      provider: PROVIDER,
      flow: FLOW,
      redirectUri: "https://app.example/cb",
      userJwt: "jwt",
      userSub: "sub-1",
    });
    const pending = engine.consume(state)!;
    await expect(engine.exchange(pending, "code")).rejects.toThrow(
      /bad_verification_code/,
    );
  });

  it("throws when a form-encoded 200 carries an error parameter", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("error=bad_verification_code&error_description=expired", {
        status: 200,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    ) as unknown as typeof fetch;
    const engine = createOAuthEngine({ fetchImpl, now: () => 0 });
    const { state } = engine.start({
      provider: { ...PROVIDER, tokenEndpointAcceptJson: false },
      flow: FLOW,
      redirectUri: "https://app.example/cb",
      userJwt: "jwt",
      userSub: "sub-1",
    });
    const pending = engine.consume(state)!;
    await expect(engine.exchange(pending, "code")).rejects.toThrow(
      /bad_verification_code/,
    );
  });

  it("throws on non-200 with the upstream body in the message", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("bad code", { status: 400 }),
    ) as unknown as typeof fetch;
    const engine = createOAuthEngine({ fetchImpl, now: () => 0 });
    const { state } = engine.start({
      provider: PROVIDER,
      flow: FLOW,
      redirectUri: "https://app.example/cb",
      userJwt: "jwt",
      userSub: "sub-1",
    });
    const pending = engine.consume(state)!;
    await expect(engine.exchange(pending, "code")).rejects.toThrow(/400.*bad code/);
  });
});
