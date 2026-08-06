import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { createGitHubAppEngine } from "../../modules/connections/infrastructure/github-app-engine.js";

const NOW_MS = 1_800_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);

// A real RSA keypair so the engine signs (and the test verifies) for real.
const { privateKey: PRIVATE_KEY_PEM, publicKey: PUBLIC_KEY_PEM } =
  crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });

interface RecordedCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}

function makeEngine(respond: (call: RecordedCall) => Response) {
  const calls: RecordedCall[] = [];
  const engine = createGitHubAppEngine({
    now: () => NOW_MS,
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const call: RecordedCall = {
        url: String(url),
        method: init?.method,
        headers: (init?.headers as Record<string, string>) ?? {},
        body: typeof init?.body === "string" ? init.body : undefined,
      };
      calls.push(call);
      return respond(call);
    }) as typeof fetch,
  });
  return { engine, calls };
}

function jsonResponse(data: unknown, status = 201): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mint(engine: ReturnType<typeof makeEngine>["engine"]) {
  return engine.mintInstallationToken({
    id: "connection:conn-1:github-app",
    appId: "123456",
    installationId: "987654",
    privateKeyPem: PRIVATE_KEY_PEM,
    apiBaseUrl: "https://api.github.com",
  });
}

function decodeJwt(jwt: string) {
  const [h, p, s] = jwt.split(".");
  return {
    segments: jwt.split(".").length,
    header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(p, "base64url").toString("utf8")),
    signingInput: `${h}.${p}`,
    signature: Buffer.from(s, "base64url"),
  };
}

describe("github app engine mintInstallationToken", () => {
  it("POSTs to the installation-token endpoint with a signed app JWT", async () => {
    const { engine, calls } = makeEngine(() =>
      jsonResponse({ token: "ghs_abc", expires_at: "2027-01-15T13:00:00Z" }),
    );
    await mint(engine);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(
      "https://api.github.com/app/installations/987654/access_tokens",
    );
    expect(calls[0].headers["Accept"]).toBe("application/vnd.github+json");
    expect(calls[0].headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(calls[0].headers["User-Agent"]).toBeTruthy();

    const auth = calls[0].headers["Authorization"];
    expect(auth?.startsWith("Bearer ")).toBe(true);
    const jwt = decodeJwt(auth.slice("Bearer ".length));
    expect(jwt.segments).toBe(3);
    expect(jwt.header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(jwt.payload.iss).toBe("123456");
    expect(jwt.payload.iat).toBe(NOW_SEC - 60);
    expect(jwt.payload.exp).toBe(NOW_SEC + 600);
    // The signature verifies against the app's public key.
    expect(
      crypto.verify(
        "RSA-SHA256",
        Buffer.from(jwt.signingInput),
        PUBLIC_KEY_PEM,
        jwt.signature,
      ),
    ).toBe(true);
  });

  it("returns the token and expiry parsed from expires_at", async () => {
    const { engine } = makeEngine(() =>
      jsonResponse({ token: "ghs_abc", expires_at: "2027-01-15T13:00:00Z" }),
    );
    const tokens = await mint(engine);
    expect(tokens.accessToken).toBe("ghs_abc");
    expect(tokens.expiresAt).toBe(
      Math.floor(Date.parse("2027-01-15T13:00:00Z") / 1000),
    );
  });

  it("falls back to a one-hour horizon when expires_at is absent", async () => {
    const { engine } = makeEngine(() => jsonResponse({ token: "ghs_abc" }));
    const tokens = await mint(engine);
    expect(tokens.expiresAt).toBe(NOW_SEC + 3600);
  });

  it("falls back to a one-hour horizon when expires_at is unparseable", async () => {
    const { engine } = makeEngine(() =>
      jsonResponse({ token: "ghs_abc", expires_at: "not-a-date" }),
    );
    const tokens = await mint(engine);
    expect(tokens.expiresAt).toBe(NOW_SEC + 3600);
  });

  it("strips a trailing slash from the API base URL", async () => {
    const { engine, calls } = makeEngine(() =>
      jsonResponse({ token: "ghs_abc" }),
    );
    await engine.mintInstallationToken({
      id: "connection:conn-1:github-app",
      appId: "123456",
      installationId: "987654",
      privateKeyPem: PRIVATE_KEY_PEM,
      apiBaseUrl: "https://ghe.example.com/api/v3/",
    });
    expect(calls[0].url).toBe(
      "https://ghe.example.com/api/v3/app/installations/987654/access_tokens",
    );
  });

  it("throws on a non-2xx response, surfacing the status", async () => {
    const { engine } = makeEngine(
      () => new Response("Bad credentials", { status: 401 }),
    );
    await expect(mint(engine)).rejects.toThrow(/401/);
  });

  it("throws when the response carries no token", async () => {
    const { engine } = makeEngine(() => jsonResponse({ expires_at: "x" }));
    await expect(mint(engine)).rejects.toThrow(/no token/);
  });

  it("throws a clear error when the private key can't sign", async () => {
    const { engine, calls } = makeEngine(() => jsonResponse({ token: "x" }));
    await expect(
      engine.mintInstallationToken({
        id: "connection:conn-1:github-app",
        appId: "123456",
        installationId: "987654",
        privateKeyPem: "not-a-key",
        apiBaseUrl: "https://api.github.com",
      }),
    ).rejects.toThrow(/could not sign/);
    expect(calls).toHaveLength(0);
  });
});

describe("github app engine token scoping", () => {
  const scopedMint = (
    engine: ReturnType<typeof makeEngine>["engine"],
    scope: { repositories?: string[]; permissions?: Record<string, string> },
  ) =>
    engine.mintInstallationToken({
      id: "connection:conn-1:github-app",
      appId: "123456",
      installationId: "987654",
      privateKeyPem: PRIVATE_KEY_PEM,
      apiBaseUrl: "https://api.github.com",
      ...scope,
    });

  // Omitting the body is what asks for the installation's full authority, so an
  // unscoped connection must keep sending no body at all.
  it("sends no body and no content-type when nothing is scoped", async () => {
    const { engine, calls } = makeEngine(() =>
      jsonResponse({ token: "ghs_abc" }),
    );
    await mint(engine);
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].headers["Content-Type"]).toBeUndefined();
  });

  it("sends no body when the scope is present but empty", async () => {
    const { engine, calls } = makeEngine(() =>
      jsonResponse({ token: "ghs_abc" }),
    );
    await scopedMint(engine, { repositories: [], permissions: {} });
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].headers["Content-Type"]).toBeUndefined();
  });

  it("sends repositories in the request body", async () => {
    const { engine, calls } = makeEngine(() =>
      jsonResponse({ token: "ghs_abc" }),
    );
    await scopedMint(engine, { repositories: ["docs"] });
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].body!)).toEqual({ repositories: ["docs"] });
  });

  it("sends permissions in the request body", async () => {
    const { engine, calls } = makeEngine(() =>
      jsonResponse({ token: "ghs_abc" }),
    );
    await scopedMint(engine, { permissions: { contents: "read" } });
    expect(JSON.parse(calls[0].body!)).toEqual({
      permissions: { contents: "read" },
    });
  });

  it("sends both halves together when both are scoped", async () => {
    const { engine, calls } = makeEngine(() =>
      jsonResponse({ token: "ghs_abc" }),
    );
    await scopedMint(engine, {
      repositories: ["docs", "handbook"],
      permissions: { contents: "read", metadata: "read" },
    });
    expect(JSON.parse(calls[0].body!)).toEqual({
      repositories: ["docs", "handbook"],
      permissions: { contents: "read", metadata: "read" },
    });
  });

  // A 422 answers a scope the installation no longer covers. Retrying re-sends
  // the same losing request, so it has to park rather than spin.
  it("marks a 422 on a scoped request as permanently rejected", async () => {
    const { engine } = makeEngine(
      () => new Response("no access to repository", { status: 422 }),
    );
    await expect(
      scopedMint(engine, { repositories: ["gone"] }),
    ).rejects.toMatchObject({ status: 422, oauthError: "invalid_grant" });
  });

  it("leaves a 422 on an unscoped request retryable", async () => {
    const { engine } = makeEngine(() => new Response("nope", { status: 422 }));
    await expect(mint(engine)).rejects.toMatchObject({
      status: 422,
      oauthError: undefined,
    });
  });

  it("still reports a rejected key as invalid_client when scoped", async () => {
    const { engine } = makeEngine(
      () => new Response("Bad credentials", { status: 401 }),
    );
    await expect(
      scopedMint(engine, { repositories: ["docs"] }),
    ).rejects.toMatchObject({ status: 401, oauthError: "invalid_client" });
  });
});
