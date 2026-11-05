import { createHmac, hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { authenticatePrincipal } from "../../apps/api-server/admission/auth.js";
import { createAuth } from "../../apps/api-server/admission/auth.js";
import {
  AGENT_TOKEN_TTL_MS,
  createAgentTokenCodec,
  createAgentTokenVerifier,
} from "../../modules/agent-tokens/index.js";

/**
 * TEST_OVERVIEW: the short-lived token an assistant exchanges its own identity
 * for — what it carries, how long it lives, and everything that makes it
 * useless: a tampered signature, an expired clock, a deleted Agent, a plain
 * Agent, an owner who moved on, and an install that stopped offering
 * assistants. Then the principal it becomes at the api-server's door: the
 * owner's Agents and read-only credentials, never an operator and never a
 * person.
 */

const HMAC = "test-pepper";
const codec = createAgentTokenCodec(HMAC);

function verifierFor(
  agent: { owner: string | null; kind?: string } | null,
  opts: { flagOn?: boolean; ownerActive?: boolean } = {},
) {
  return createAgentTokenVerifier({
    codec,
    agentOf: async () => agent,
    featureOn: async () => opts.flagOn ?? true,
    ownerActive: async () => opts.ownerActive ?? true,
  });
}

const site = { edge: "http" as const, target: "/api/trpc/agents.list" };

describe("agent token codec", () => {
  it("mints a token that reads back as the agent and owner it was minted for", () => {
    const { token, expiresAt } = codec.mint({
      agentId: "agent-1",
      ownerSub: "owner-1",
    });
    expect(token.startsWith("ob_")).toBe(true);
    const read = codec.read(token);
    expect(read?.agentId).toBe("agent-1");
    expect(read?.ownerSub).toBe("owner-1");
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      AGENT_TOKEN_TTL_MS,
    );
  });

  it("refuses a token whose payload was edited without the pepper", () => {
    const { token } = codec.mint({ agentId: "agent-1", ownerSub: "owner-1" });
    const [, mac] = token.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ a: "agent-2", o: "owner-1", e: 9_999_999_999 }),
    ).toString("base64url");
    expect(codec.read(`ob_${forgedBody}.${mac}`)).toBeNull();
  });

  it("refuses a token signed with another pepper", () => {
    const other = createAgentTokenCodec("another-pepper");
    const { token } = other.mint({
      agentId: "agent-1",
      ownerSub: "owner-1",
    });
    expect(codec.read(token)).toBeNull();
  });

  it("signs with a key derived from the pepper, not with the pepper itself", () => {
    const { token } = codec.mint({ agentId: "agent-1", ownerSub: "owner-1" });
    const [body, mac] = token.slice("ob_".length).split(".") as [
      string,
      string,
    ];
    const rawPepperMac = createHmac("sha256", HMAC)
      .update(body)
      .digest("base64url");
    expect(mac).not.toBe(rawPepperMac);
    expect(codec.read(`ob_${body}.${rawPepperMac}`)).toBeNull();
  });

  it("refuses claims that are not the shape it counts on", () => {
    const sign = (claims: unknown) => {
      const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const mac = createHmac(
        "sha256",
        Buffer.from(
          hkdfSync(
            "sha256",
            HMAC,
            Buffer.alloc(0),
            "platform/agent-obo/v1",
            32,
          ),
        ),
      )
        .update(body)
        .digest("base64url");
      return `ob_${body}.${mac}`;
    };
    const exp = Math.floor(Date.now() / 1000) + 600;
    expect(codec.read(sign(["agent-1", "owner-1", exp]))).toBeNull();
    expect(codec.read(sign(null))).toBeNull();
    expect(codec.read(sign({ a: "", o: "owner-1", e: exp }))).toBeNull();
    expect(
      codec.read(sign({ a: "agent-1", o: "owner-1", e: "soon" })),
    ).toBeNull();
    expect(codec.read(sign({ a: "agent-1", o: "owner-1", e: 1.5 }))).toBeNull();
    expect(
      codec.read(sign({ a: "x".repeat(300), o: "owner-1", e: exp })),
    ).toBeNull();
    expect(
      codec.read(sign({ a: "agent-1\u0000", o: "owner-1", e: exp })),
    ).toBeNull();
    expect(
      codec.read(sign({ a: "agent-1", o: "owner-1", e: exp })),
    ).toMatchObject({
      agentId: "agent-1",
    });
  });

  it("refuses a body or MAC that is not the canonical base64url spelling", () => {
    const { token } = codec.mint({ agentId: "agent-1", ownerSub: "owner-1" });
    const [body, mac] = token.slice("ob_".length).split(".") as [
      string,
      string,
    ];
    const padded = `${body}=`;
    expect(codec.read(`ob_${padded}.${mac}`)).toBeNull();
    expect(codec.read(`ob_${body}.${mac}=`)).toBeNull();
    expect(codec.read(`ob_${body}\n.${mac}`)).toBeNull();
  });

  it("refuses an expired token", () => {
    const { token } = codec.mint({
      agentId: "agent-1",
      ownerSub: "owner-1",
      ttlMs: -1,
    });
    expect(codec.read(token)).toBeNull();
  });
});

describe("agent token verifier", () => {
  const mint = () =>
    codec.mint({ agentId: "agent-1", ownerSub: "owner-1" }).token;

  it("accepts a token whose Agent is still the owner's assistant", async () => {
    const verified = await verifierFor({
      owner: "owner-1",
      kind: "assistant",
    })(mint());
    expect(verified.ok).toBe(true);
  });

  it("refuses once the Agent is deleted", async () => {
    const verified = await verifierFor(null)(mint());
    expect(verified).toEqual({ ok: false, error: "agent-gone" });
  });

  it("refuses an Agent that is not an assistant", async () => {
    const verified = await verifierFor({ owner: "owner-1" })(mint());
    expect(verified).toEqual({ ok: false, error: "not-assistant" });
  });

  it("refuses when the Agent's owner label moved on", async () => {
    const verified = await verifierFor({
      owner: "someone-else",
      kind: "assistant",
    })(mint());
    expect(verified).toEqual({ ok: false, error: "owner-mismatch" });
  });

  it("refuses when the install stopped offering assistants to that owner", async () => {
    const verified = await verifierFor(
      { owner: "owner-1", kind: "assistant" },
      { flagOn: false },
    )(mint());
    expect(verified).toEqual({ ok: false, error: "flag-off" });
  });

  it("refuses a token this install never signed", async () => {
    const verified = await verifierFor({
      owner: "owner-1",
      kind: "assistant",
    })("ob_nonsense.nonsense");
    expect(verified).toEqual({ ok: false, error: "unknown" });
  });
});

describe("the principal an agent token becomes", () => {
  const auth = createAuth(
    {
      issuers: ["http://kc/realms/platform"],
      jwksUrl: "http://kc/jwks",
    },
    {
      verifyAgentToken: async (token) => {
        const read = codec.read(token);
        return read
          ? { ok: true, value: read }
          : { ok: false, error: "unknown" };
      },
    },
  );

  const admitted = async () => {
    const { token } = codec.mint({
      agentId: "agent-1",
      ownerSub: "owner-1",
    });
    return authenticatePrincipal(auth.verify, token, site);
  };

  it("acts as the owner over their Agents, with credentials:read but not credentials:manage", async () => {
    const result = await admitted();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { user } = result.principal;
    expect(user.sub).toBe("owner-1");
    expect(user.onBehalfAgentId).toBe("agent-1");
    expect(user.agentIds).toBe("*");
    expect(user.scopes).toContain("agents:manage");
    expect(user.scopes).toContain("credentials:read");
    expect(user.scopes).not.toContain("credentials:manage");
    expect(user.isOperator).toBeUndefined();
    expect(user.keyId).toBeUndefined();
  });

  it("answers 401 for a token that is expired or not ours", async () => {
    const { token } = codec.mint({
      agentId: "agent-1",
      ownerSub: "owner-1",
      ttlMs: -1,
    });
    const result = await authenticatePrincipal(auth.verify, token, site);
    expect(result).toEqual({ ok: false, kind: "unauthorized" });
  });
});
