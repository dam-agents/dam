/**
 * TEST_OVERVIEW: Sign-in on the artifact share host. The share host gets its own
 * Keycloak client and a server-side share session behind an HttpOnly cookie.
 * /auth/login starts an authorization-code + PKCE flow and remembers where to
 * return; /auth/callback redeems the code, verifies the ID token (issuer,
 * audience, nonce), and sets the cookie; /auth/logout drops the session and
 * sends the browser to Keycloak's end-session endpoint. The return path is only
 * ever a relative /a/<slug> path on this host, never an outside URL.
 */
import { Hono } from "hono";
import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { createMemoryTtlStore } from "../../core/ttl-store.js";
import {
  isSafeNext,
  SHARE_LOGIN_TTL_MS,
  SHARE_SESSION_TTL_MS,
  type PendingLogin,
  type ShareSession,
} from "../../modules/artifact-library/domain/share-session.js";
import { createKeycloakShareIdentity } from "../../modules/artifact-library/infrastructure/keycloak-share-identity.js";
import {
  createShareAuthService,
  type ShareIdentity,
  type ShareIdentityProvider,
} from "../../modules/artifact-library/services/share-auth-service.js";
import { createShareAuthRoutes } from "../../modules/artifact-library/viewer/share-auth-routes.js";
import { createShareHostApp } from "../../modules/kb-shares/serving/compose.js";

const SHARE = "https://share.example.test";

type IdentityFn = (input: {
  code: string;
  codeVerifier: string;
  nonce: string;
}) => ShareIdentity | string;

function fakeProvider(identity: IdentityFn): ShareIdentityProvider {
  let lastNonce = "";
  return {
    authorizeUrl(input) {
      lastNonce = input.nonce;
      const url = new URL("https://kc.example.test/realms/r/auth");
      url.searchParams.set("state", input.state);
      url.searchParams.set("nonce", input.nonce);
      url.searchParams.set("code_challenge", input.codeChallenge);
      return url.href;
    },
    async redeemCode(input) {
      const out = identity({ ...input, nonce: lastNonce });
      return typeof out === "string"
        ? { ok: false, error: out }
        : { ok: true, value: out };
    },
    endSessionUrl(input) {
      return `https://kc.example.test/realms/r/logout?post_logout_redirect_uri=${encodeURIComponent(input.postLogoutRedirectUri)}`;
    },
  };
}

const alice: IdentityFn = ({ nonce }) => ({
  sub: "u1",
  email: "alice@example.com",
  emailVerified: true,
  nonce,
});

function setup(identity: IdentityFn = alice) {
  const pending = createMemoryTtlStore<PendingLogin>(SHARE_LOGIN_TTL_MS);
  const sessions = createMemoryTtlStore<ShareSession>(SHARE_SESSION_TTL_MS);
  const auth = createShareAuthService({
    provider: fakeProvider(identity),
    pending,
    sessions,
    shareBaseUrl: SHARE,
    now: () => 1_000,
  });
  const host = createShareHostApp({
    viewer: new Hono().all("*", (c) => c.text("viewer", 200)),
    kbMcp: new Hono(),
    auth: createShareAuthRoutes({
      auth,
      brandName: "Acme",
      secureCookie: true,
    }),
  });
  const get = (path: string, cookie?: string) =>
    host.fetch(
      new Request(`${SHARE}${path}`, { headers: cookie ? { cookie } : {} }),
    );
  return { pending, sessions, auth, get };
}

async function signIn(s: ReturnType<typeof setup>, next: string) {
  const login = await s.get(`/auth/login?next=${encodeURIComponent(next)}`);
  const state = new URL(login.headers.get("location")!).searchParams.get(
    "state",
  )!;
  return s.get(`/auth/callback?state=${state}&code=c1`);
}

describe("isSafeNext", () => {
  /**
   * TEST_SCENARIO: The return path after sign-in comes from the query string.
   * Only a share page or its raw download on this host may be returned to.
   */
  it("accepts only relative /a/<slug> paths", () => {
    expect(isSafeNext("/a/xyz")).toBe(true);
    expect(isSafeNext("/a/xyz/raw?v=2&download=1")).toBe(true);
    expect(isSafeNext("/a/xyz?v=3")).toBe(true);
    expect(isSafeNext("/")).toBe(false);
    expect(isSafeNext("/f/folder")).toBe(false);
    expect(isSafeNext("//evil.example/a/x")).toBe(false);
    expect(isSafeNext("https://evil.example")).toBe(false);
    expect(isSafeNext("/a/xyz/../../auth/login")).toBe(false);
    expect(isSafeNext("/a/xyz#frag")).toBe(false);
  });
});

describe("share host sign-in", () => {
  /**
   * TEST_SCENARIO: /auth/login must send the browser to Keycloak with a fresh
   * state, nonce, and S256 challenge, and keep the verifier server-side only.
   */
  it("redirects to the identity provider and keeps PKCE state server-side", async () => {
    const s = setup();
    const res = await s.get("/auth/login?next=/a/xyz");
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("https://kc.example.test");
    const state = to.searchParams.get("state")!;
    const stored = await s.pending.peek(state);
    expect(stored?.next).toBe("/a/xyz");
    expect(stored?.nonce).toBe(to.searchParams.get("nonce"));
    expect(to.searchParams.has("code_verifier")).toBe(false);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  /**
   * TEST_SCENARIO: After a good callback the browser holds only an opaque
   * session id in an HttpOnly, Secure, SameSite=Lax cookie and lands on `next`.
   */
  it("sets the share session cookie and returns to the requested page", async () => {
    const s = setup();
    const res = await signIn(s, "/a/xyz?v=2");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/a/xyz?v=2");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^share_session=[A-Za-z0-9_-]{40,};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    const id = /^share_session=([^;]+)/.exec(cookie)![1]!;
    expect(await s.sessions.peek(id)).toEqual({
      sub: "u1",
      email: "alice@example.com",
      emailVerified: true,
      createdAt: 1_000,
    });
  });

  /**
   * TEST_SCENARIO: An outside URL in `next` must never be followed after
   * sign-in; the fallback is the host root.
   */
  it("falls back to / when next is not a share path", async () => {
    const s = setup();
    const res = await signIn(s, "https://evil.example/");
    expect(res.headers.get("location")).toBe("/");
  });

  /**
   * TEST_SCENARIO: A state that was never issued, already consumed, or expired
   * must not create a session. The pending entry is single-use.
   */
  it("rejects an unknown or replayed state", async () => {
    const s = setup();
    const first = await signIn(s, "/a/xyz");
    const state = new URL(
      (await s.get("/auth/login?next=/a/xyz")).headers.get("location")!,
    ).searchParams.get("state")!;
    await s.get(`/auth/callback?state=${state}&code=c1`);
    const replay = await s.get(`/auth/callback?state=${state}&code=c1`);
    expect(first.status).toBe(302);
    expect(replay.status).toBe(400);
    expect(replay.headers.get("set-cookie")).toBeNull();
    expect(await replay.text()).toContain("/auth/login?next=%2F");
    const bogus = await s.get("/auth/callback?state=nope&code=c1");
    expect(bogus.status).toBe(400);
  });

  /**
   * TEST_SCENARIO: The ID token's nonce must match the one minted at login;
   * otherwise a token from another flow could be injected into this session.
   */
  it("rejects an ID token whose nonce does not match", async () => {
    const s = setup(() => ({
      sub: "u1",
      email: null,
      emailVerified: false,
      nonce: "someone-elses",
    }));
    const res = await signIn(s, "/a/xyz");
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  /**
   * TEST_SCENARIO: Logout must drop the server-side session, clear the cookie,
   * and send the browser to Keycloak so the SSO cookie is dropped too, with a
   * safe return to /auth/login carrying the same `next`.
   */
  it("ends the session and redirects to the provider's end-session endpoint", async () => {
    const s = setup();
    const signedIn = await signIn(s, "/a/xyz");
    const cookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
    const id = cookie.split("=")[1]!;
    expect(await s.auth.getSession(id)).not.toBeNull();

    const res = await s.get("/auth/logout?next=/a/xyz", cookie);
    expect(res.status).toBe(302);
    expect(await s.auth.getSession(id)).toBeNull();
    expect(res.headers.get("set-cookie")).toMatch(
      /^share_session=;.*Max-Age=0/,
    );
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/realms/r/logout");
    expect(to.searchParams.get("post_logout_redirect_uri")).toBe(
      `${SHARE}/auth/login?next=%2Fa%2Fxyz`,
    );
  });

  /**
   * TEST_SCENARIO: Non-auth paths still reach the viewer app; the auth sub-app
   * only claims /auth/*.
   */
  it("leaves other share-host paths to the viewer", async () => {
    const s = setup();
    const res = await s.get("/a/xyz");
    expect(await res.text()).toBe("viewer");
  });
});

describe("Keycloak share identity", () => {
  const cfg = {
    keycloakExternalUrl: "https://kc.example.test",
    keycloakUrl: "http://keycloak.internal:8080",
    realm: "platform",
    clientId: "platform-share",
    callbackUrl: `${SHARE}/auth/callback`,
  };

  /**
   * TEST_SCENARIO: The authorize URL is browser-facing, so it must use the
   * external Keycloak URL and carry the share client and PKCE parameters.
   */
  it("builds the authorize URL on the external Keycloak host", () => {
    const provider = createKeycloakShareIdentity(cfg, {
      fetch: () => Promise.reject(new Error("unused")),
      idTokenKey: () => Promise.reject(new Error("unused")),
    });
    const url = new URL(
      provider.authorizeUrl({ state: "s", nonce: "n", codeChallenge: "c" }),
    );
    expect(url.origin).toBe("https://kc.example.test");
    expect(url.pathname).toBe("/realms/platform/protocol/openid-connect/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "platform-share",
      redirect_uri: `${SHARE}/auth/callback`,
      scope: "openid email",
      state: "s",
      nonce: "n",
      code_challenge: "c",
      code_challenge_method: "S256",
    });
  });

  /**
   * TEST_SCENARIO: The code is redeemed over the in-cluster Keycloak URL and the
   * ID token is verified against issuer and audience before any claim is read.
   * A token minted for another client (audience) is refused.
   */
  it("redeems the code internally and verifies the ID token", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const mint = (aud: string) =>
      new SignJWT({
        email: "alice@example.com",
        email_verified: true,
        nonce: "n1",
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer("https://kc.example.test/realms/platform")
        .setAudience(aud)
        .setSubject("u1")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
    const calls: { url: string; body: URLSearchParams }[] = [];
    const providerFor = (aud: string) =>
      createKeycloakShareIdentity(cfg, {
        idTokenKey: () => Promise.resolve(publicKey),
        fetch: async (input, init) => {
          calls.push({
            url: String(input),
            body: init?.body as URLSearchParams,
          });
          return new Response(JSON.stringify({ id_token: await mint(aud) }), {
            status: 200,
          });
        },
      });

    const good = await providerFor("platform-share").redeemCode({
      code: "c1",
      codeVerifier: "v1",
    });
    expect(good).toEqual({
      ok: true,
      value: {
        sub: "u1",
        email: "alice@example.com",
        emailVerified: true,
        nonce: "n1",
      },
    });
    expect(calls[0]!.url).toBe(
      "http://keycloak.internal:8080/realms/platform/protocol/openid-connect/token",
    );
    expect(Object.fromEntries(calls[0]!.body)).toEqual({
      grant_type: "authorization_code",
      code: "c1",
      redirect_uri: `${SHARE}/auth/callback`,
      client_id: "platform-share",
      code_verifier: "v1",
    });

    const wrongAudience = await providerFor("platform-ui").redeemCode({
      code: "c1",
      codeVerifier: "v1",
    });
    expect(wrongAudience.ok).toBe(false);
  });
});
