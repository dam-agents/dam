import { describe, it, expect, vi, beforeEach } from "vitest";

const { reloadMock } = vi.hoisted(() => ({ reloadMock: vi.fn() }));

vi.mock("jose", () => ({
  createRemoteJWKSet: () => Object.assign(() => ({}), { reload: reloadMock }),
  jwtVerify: vi.fn(),
}));

import { jwtVerify } from "jose";
import {
  JOSEError,
  JWKSInvalid,
  JWKSNoMatchingKey,
  JWKSTimeout,
  JWTExpired,
} from "jose/errors";
import {
  authenticatePrincipal,
  createAuth,
} from "../../apps/api-server/admission/auth.js";
import { createAuthMiddleware } from "../../apps/api-server/admission/auth-middleware.js";
import { configureLogger } from "../../core/logger.js";

const verifyMock = jwtVerify as unknown as ReturnType<typeof vi.fn>;

function capture() {
  const lines: string[] = [];
  configureLogger({ level: "info", write: (l) => lines.push(l) });
  return { records: () => lines.map((l) => JSON.parse(l)) };
}

function fakeCtx(headers: Record<string, string>, path = "/api/trpc/x") {
  const responses: { body: unknown; status: number }[] = [];
  const c = {
    req: { path, header: (n: string) => headers[n.toLowerCase()] },
    set: () => {},
    json: (body: unknown, status: number) => {
      responses.push({ body, status });
      return { body, status };
    },
  };
  return { c, responses };
}

const auth = createAuth({
  issuerUrl: "http://kc/realms/platform",
  jwksUrl: "http://kc/jwks",
  audience: "platform-api",
  requiredRole: "platform-access",
  uiClientId: "platform-ui",
  cliClientId: "platform-cli",
});
const middleware = createAuthMiddleware(
  (token, site) => authenticatePrincipal(auth.verify, token, site),
  { uiClientId: "platform-ui", cliClientId: "platform-cli" },
);

const next = async () => "NEXT" as never;

beforeEach(() => verifyMock.mockReset());

describe("auth middleware audit", () => {
  it("logs authn.deny with reason=missing-bearer and no token when the header is absent", async () => {
    const cap = capture();
    const { c, responses } = fakeCtx({});
    await middleware(c as any, next as any);
    expect(responses[0]!.status).toBe(401);
    const rec = cap.records().find((r) => r.msg === "authn.deny")!;
    expect(rec.category).toBe("authn");
    expect(rec.reason).toBe("missing-bearer");
    expect(rec.target).toBe("/api/trpc/x");
  });

  it("logs authn.deny with the verify-error class (never the token) on a bad JWT", async () => {
    const cap = capture();
    verifyMock.mockRejectedValueOnce(
      new JWTExpired('"exp" claim timestamp check failed', {}),
    );
    const { c, responses } = fakeCtx({
      authorization: "Bearer SECRET.JWT.VAL",
    });
    await middleware(c as any, next as any);
    expect(responses[0]!.status).toBe(401);
    const rec = cap.records().find((r) => r.msg === "authn.deny")!;
    expect(rec.reason).toBe("JWTExpired");
    expect(JSON.stringify(cap.records())).not.toContain("SECRET.JWT.VAL");
  });

  it("returns 503 and logs authn.unavailable when the JWKS fetch fails", async () => {
    const cap = capture();
    verifyMock.mockRejectedValueOnce(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      }),
    );
    const { c, responses } = fakeCtx({
      authorization: "Bearer SECRET.JWT.VAL",
    });
    await middleware(c as any, next as any);
    expect(responses[0]).toEqual({
      body: { error: "auth unavailable" },
      status: 503,
    });
    const rec = cap.records().find((r) => r.msg === "authn.unavailable")!;
    expect(rec.reason).toBe("jwks-unavailable");
    expect(rec.detail.cause).toBe("TypeError: ECONNREFUSED");
    expect(cap.records().some((r) => r.msg === "authn.deny")).toBe(false);
    expect(JSON.stringify(cap.records())).not.toContain("SECRET.JWT.VAL");
  });

  it("keeps a message-only TypeError (jose-internal, attacker-forgeable) at 401", async () => {
    const cap = capture();
    verifyMock.mockRejectedValueOnce(
      new TypeError("non-ASCII string encountered in encode()"),
    );
    const { c, responses } = fakeCtx({ authorization: "Bearer x" });
    await middleware(c as any, next as any);
    expect(responses[0]!.status).toBe(401);
    const rec = cap.records().find((r) => r.msg === "authn.deny")!;
    expect(rec.reason).toBe("TypeError");
    expect(cap.records().some((r) => r.msg === "authn.unavailable")).toBe(
      false,
    );
  });

  it("returns 503 on a JWKS fetch timeout", async () => {
    const cap = capture();
    verifyMock.mockRejectedValueOnce(new JWKSTimeout());
    const { c, responses } = fakeCtx({ authorization: "Bearer x" });
    await middleware(c as any, next as any);
    expect(responses[0]!.status).toBe(503);
    const rec = cap.records().find((r) => r.msg === "authn.unavailable")!;
    expect(rec.reason).toBe("jwks-unavailable");
  });

  it("returns 503 when the JWKS endpoint answers non-200/non-JSON", async () => {
    const cap = capture();
    verifyMock.mockRejectedValueOnce(
      new JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response"),
    );
    const { c, responses } = fakeCtx({ authorization: "Bearer x" });
    await middleware(c as any, next as any);
    expect(responses[0]!.status).toBe(503);
    expect(cap.records().some((r) => r.msg === "authn.unavailable")).toBe(true);
  });

  it("returns 503 when a fetched JWKS body is malformed (200 non-key-set)", async () => {
    const cap = capture();
    verifyMock.mockRejectedValueOnce(
      new JWKSInvalid("JSON Web Key Set malformed"),
    );
    const { c, responses } = fakeCtx({ authorization: "Bearer x" });
    await middleware(c as any, next as any);
    expect(responses[0]!.status).toBe(503);
    expect(cap.records().some((r) => r.msg === "authn.unavailable")).toBe(true);
  });

  it("keeps a fetched-but-unmatched key (kid probing, rotation) at 401", async () => {
    const cap = capture();
    verifyMock.mockRejectedValueOnce(new JWKSNoMatchingKey());
    const { c, responses } = fakeCtx({ authorization: "Bearer x" });
    await middleware(c as any, next as any);
    expect(responses[0]!.status).toBe(401);
    const rec = cap.records().find((r) => r.msg === "authn.deny")!;
    expect(rec.reason).toBe("JWKSNoMatchingKey");
  });

  it("keeps API-key denials at 401 with their reason", async () => {
    const cap = capture();
    const apiKeyAuth = createAuth(
      {
        issuerUrl: "http://kc/realms/platform",
        jwksUrl: "http://kc/jwks",
        uiClientId: "platform-ui",
        cliClientId: "platform-cli",
      },
      { verifyApiKey: async () => ({ ok: false, error: "revoked" }) },
    );
    const apiKeyMiddleware = createAuthMiddleware(
      (token, site) => authenticatePrincipal(apiKeyAuth.verify, token, site),
      { uiClientId: "platform-ui", cliClientId: "platform-cli" },
    );
    const { c, responses } = fakeCtx({ authorization: "Bearer pk_x" });
    await apiKeyMiddleware(c as any, next as any);
    expect(responses[0]!.status).toBe(401);
    const rec = cap.records().find((r) => r.msg === "authn.deny")!;
    expect(rec.reason).toBe("revoked");
  });

  it("warmJwks delegates to the remote JWK set's reload", async () => {
    reloadMock.mockResolvedValueOnce(undefined);
    await auth.warmJwks();
    expect(reloadMock).toHaveBeenCalled();
  });

  it("logs authz.deny against the decoded sub when the required role is missing", async () => {
    const cap = capture();
    verifyMock.mockResolvedValueOnce({
      payload: {
        sub: "kc-denied",
        azp: "platform-ui",
        preferred_username: "u",
        realm_access: { roles: ["some-other-role"] },
      },
    });
    const { c, responses } = fakeCtx({ authorization: "Bearer x" });
    await middleware(c as any, next as any);
    expect(responses[0]!.status).toBe(403);
    const rec = cap.records().find((r) => r.msg === "authz.deny")!;
    expect(rec.category).toBe("authz");
    expect(rec.actor).toBe("kc-denied");
    expect(rec.detail.requiredRole).toBe("platform-access");
  });

  it("does not emit a deny line on a valid, authorized token", async () => {
    const cap = capture();
    verifyMock.mockResolvedValueOnce({
      payload: {
        sub: "kc-ok",
        azp: "platform-ui",
        preferred_username: "u",
        realm_access: { roles: ["platform-access"] },
      },
    });
    const { c } = fakeCtx({ authorization: "Bearer x" });
    const result = await middleware(c as any, next as any);
    expect(result).toBe("NEXT");
    expect(cap.records().some((r) => String(r.msg).endsWith(".deny"))).toBe(
      false,
    );
  });
});
