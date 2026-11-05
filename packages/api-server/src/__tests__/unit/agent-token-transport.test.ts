import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { UserIdentity } from "api-server-api";
import {
  authenticatePrincipal,
  createAuth,
} from "../../apps/api-server/admission/auth.js";
import { createAgentTrpcProxy } from "../../apps/api-server/agent-proxies/trpc-proxy.js";
import { createImportProxy } from "../../apps/api-server/agent-proxies/import-proxy.js";
import { createRelayAdmission } from "../../apps/api-server/agent-proxies/upgrade.js";
import { createAgentTokenCodec } from "../../modules/agent-tokens/index.js";
import { createAgentTokenVerifier } from "../../modules/agent-tokens/index.js";
import { agentOnBehalfUser } from "../../modules/agent-tokens/index.js";

/**
 * TEST_OVERVIEW: an assistant's own token reaches the app tRPC API and nothing
 * else. Each test below drives a real transport admission — the runtime-tRPC
 * proxy, the import proxy, the WebSocket relay admission — with a principal
 * derived by the same code the bearer middleware uses, and asserts the door is
 * shut; then the app tRPC door itself, where the same token is admitted and
 * carries its expiry so a stream can close on it.
 */

const codec = createAgentTokenCodec("test-pepper");

const verifier = createAgentTokenVerifier({
  codec,
  agentOf: async () => ({ owner: "owner-1", kind: "assistant" }),
  featureOn: async () => true,
  ownerActive: async () => true,
});

const auth = createAuth(
  { issuers: ["http://kc/realms/platform"], jwksUrl: "http://kc/jwks" },
  {
    verifyAgentToken: async (token) => {
      const result = await verifier(token);
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, error: result.error };
    },
  },
);

const site = { edge: "http" as const, target: "/api/trpc/agents.list" };

/* TEST_SCENARIO: the principal the bearer middleware derives for a freshly minted `ob_` token, so every transport below is driven as the real one is. */
async function assistantPrincipal(): Promise<UserIdentity> {
  const { token } = codec.mint({ agentId: "agent-a", ownerSub: "owner-1" });
  const admitted = await authenticatePrincipal(auth.verify, token, site);
  if (!admitted.ok) throw new Error("the assistant token was refused");
  return admitted.principal.user;
}

const PERSON: UserIdentity = {
  sub: "owner-1",
  preferredUsername: "owner-1",
  scopes: ["agents:read", "agents:operate", "agents:manage"],
  agentIds: "*",
};

function mount(user: UserIdentity, mountRoute: (app: Hono<never>) => void) {
  const app = new Hono<{ Variables: { user: UserIdentity } }>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  mountRoute(app as never);
  return app;
}

describe("the runtime-tRPC proxy", () => {
  const app = async (user: UserIdentity) =>
    mount(user, (a) =>
      a.all(
        "/api/agents/:id/trpc/*",
        createAgentTrpcProxy({
          namespace: "platform",
          verifyOwner: async () => true,
          editorRuntime: async () => false,
          ensureReady: async () => {},
          upstreamBase: () => "http://127.0.0.1:1",
        }),
      ),
    );

  it("refuses an assistant's own token", async () => {
    const response = await (
      await app(await assistantPrincipal())
    ).request("/api/agents/agent-a/trpc/files.remove", { method: "POST" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "forbidden" });
  });

  it("still admits the same owner as a person", async () => {
    const response = await (
      await app(PERSON)
    ).request("/api/agents/agent-a/trpc/files.remove", { method: "POST" });
    // UNIT_BOUNDARY_DESCRIPTION: the upstream is deliberately unreachable, so a 5xx/502 here means the door was opened rather than refused.
    expect(response.status).not.toBe(403);
  });
});

describe("the import proxy", () => {
  const app = async (user: UserIdentity) =>
    mount(user, (a) =>
      a.post(
        "/api/agents/:id/import",
        createImportProxy({
          namespace: "platform",
          maxImportBundleBytes: 1024,
          verifyOwner: async () => true,
          ensureReady: async () => {},
        }),
      ),
    );

  it("refuses an assistant's own token", async () => {
    const response = await (
      await app(await assistantPrincipal())
    ).request("/api/agents/agent-a/import", {
      method: "POST",
      headers: { "content-length": "0" },
    });
    expect(response.status).toBe(403);
  });

  it("still admits the same owner as a person", async () => {
    const response = await (
      await app(PERSON)
    ).request("/api/agents/agent-a/import", {
      method: "POST",
      headers: { "content-length": "0" },
    });
    expect(response.status).not.toBe(403);
  });
});

describe("the WebSocket relay admission", () => {
  // UNIT_BOUNDARY_DESCRIPTION: the real admission, driven with the real authenticate: the token travels in the query string, exactly as a browser or the CLI sends it.
  const admissionFor = (token: string) => {
    const admission = createRelayAdmission({
      authenticate: (value, at) =>
        authenticatePrincipal(auth.verify, value, at ?? site),
      standingOf: async () => ({ role: "owner" }),
      editorSockets: {
        track: () => {},
      } as never,
      isTermsAccepted: async () => true,
      surfaceAttribution: { uiClientId: "ui", cliClientId: "cli" },
    });
    const url = new URL(
      `http://api/api/agents/agent-a/acp?token=${encodeURIComponent(token)}`,
    );
    return admission({ headers: {}, socket: {} } as never, url, "agent-a", {
      kind: "acp",
      permission: "sessions",
    });
  };

  it("refuses an assistant's own token on the ACP relay", async () => {
    const { token } = codec.mint({
      agentId: "agent-a",
      ownerSub: "owner-1",
    });
    expect(await admissionFor(token)).toEqual({
      ok: false,
      kind: "not-permitted",
    });
  });

  it("refuses it on every relay that shares that admission", async () => {
    const { token } = codec.mint({
      agentId: "agent-a",
      ownerSub: "owner-1",
    });
    const url = new URL(
      `http://api/api/agents/agent-a/terminal?token=${encodeURIComponent(token)}`,
    );
    const admission = createRelayAdmission({
      authenticate: (value, at) =>
        authenticatePrincipal(auth.verify, value, at ?? site),
      standingOf: async () => ({ role: "owner" }),
      editorSockets: { track: () => {} } as never,
      isTermsAccepted: async () => true,
      surfaceAttribution: { uiClientId: "ui", cliClientId: "cli" },
    });
    expect(
      await admission({ headers: {}, socket: {} } as never, url, "agent-a", {
        kind: "terminal",
        permission: "terminal",
      }),
    ).toEqual({ ok: false, kind: "not-permitted" });
  });
});

describe("the app tRPC door", () => {
  it("admits the assistant and carries the token's expiry, so a stream can close on it", async () => {
    const { token, expiresAt } = codec.mint({
      agentId: "agent-a",
      ownerSub: "owner-1",
    });
    const admitted = await authenticatePrincipal(auth.verify, token, site);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    // UNIT_BOUNDARY_DESCRIPTION: the claims carry whole seconds, so the expiry reads back within the second it was minted for.
    expect(
      Math.abs(
        (admitted.principal.expiresAt?.getTime() ?? 0) - expiresAt.getTime(),
      ),
    ).toBeLessThan(1_000);
    expect(admitted.principal.user).toEqual(
      agentOnBehalfUser({ agentId: "agent-a", ownerSub: "owner-1" }),
    );
  });

  it("refuses a replayed token once it expired", async () => {
    const { token } = codec.mint({
      agentId: "agent-a",
      ownerSub: "owner-1",
      ttlMs: -1,
    });
    expect(await authenticatePrincipal(auth.verify, token, site)).toEqual({
      ok: false,
      kind: "unauthorized",
    });
  });

  it("refuses the whole kind when the owner's account is no longer admitted", async () => {
    const inactive = createAuth(
      { issuers: ["http://kc/realms/platform"], jwksUrl: "http://kc/jwks" },
      {
        verifyAgentToken: async (token) => {
          const result = await createAgentTokenVerifier({
            codec,
            agentOf: async () => ({ owner: "owner-1", kind: "assistant" }),
            featureOn: async () => true,
            ownerActive: async () => false,
          })(token);
          return result.ok
            ? { ok: true, value: result.value }
            : { ok: false, error: result.error };
        },
      },
    );
    const { token } = codec.mint({
      agentId: "agent-a",
      ownerSub: "owner-1",
    });
    expect(await authenticatePrincipal(inactive.verify, token, site)).toEqual({
      ok: false,
      kind: "unauthorized",
    });
  });
});
