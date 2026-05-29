import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub jose so the middleware can be exercised without a real Keycloak/JWKS.
vi.mock("jose", () => ({
  createRemoteJWKSet: () => () => ({}),
  jwtVerify: vi.fn(),
}));

import { jwtVerify } from "jose";
import { createAuth } from "../../apps/api-server/auth.js";
import { configureLogger } from "../../core/logger.js";

const verifyMock = jwtVerify as unknown as ReturnType<typeof vi.fn>;

function capture() {
  const lines: string[] = [];
  configureLogger({ level: "info", write: (l) => lines.push(l) });
  return { records: () => lines.map((l) => JSON.parse(l)) };
}

/** Minimal Hono-context stub covering what the auth middleware touches. */
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

const next = async () => "NEXT" as never;

beforeEach(() => verifyMock.mockReset());

describe("auth middleware audit", () => {
  it("logs authn.deny with reason=missing-bearer and no token when the header is absent", async () => {
    const cap = capture();
    const { c, responses } = fakeCtx({});
    await auth.middleware(c as any, next as any);
    expect(responses[0]!.status).toBe(401);
    const rec = cap.records().find((r) => r.msg === "authn.deny")!;
    expect(rec.category).toBe("authn");
    expect(rec.reason).toBe("missing-bearer");
    expect(rec.target).toBe("/api/trpc/x");
  });

  it("logs authn.deny with the verify-error class (never the token) on a bad JWT", async () => {
    const cap = capture();
    const err = new Error("expired");
    err.name = "JWTExpired";
    verifyMock.mockRejectedValueOnce(err);
    const { c, responses } = fakeCtx({
      authorization: "Bearer SECRET.JWT.VAL",
    });
    await auth.middleware(c as any, next as any);
    expect(responses[0]!.status).toBe(401);
    const rec = cap.records().find((r) => r.msg === "authn.deny")!;
    expect(rec.reason).toBe("JWTExpired");
    expect(JSON.stringify(cap.records())).not.toContain("SECRET.JWT.VAL");
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
    await auth.middleware(c as any, next as any);
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
    const result = await auth.middleware(c as any, next as any);
    expect(result).toBe("NEXT");
    expect(cap.records().some((r) => String(r.msg).endsWith(".deny"))).toBe(
      false,
    );
  });
});
