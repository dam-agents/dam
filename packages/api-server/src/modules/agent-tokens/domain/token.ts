import { createHmac, timingSafeEqual } from "node:crypto";
import { AGENT_TOKEN_PREFIX } from "api-server-api";

/* UNIT_BOUNDARY_DESCRIPTION: how long one minted token lives. Short, because
 * every refresh is cheap — the exchange proves the caller is the agent by the
 * handful of mesh hops it takes to reach the harness route — and because a
 * token that leaks out of the machine stops working soon after. */
export const AGENT_TOKEN_TTL_MS = 15 * 60_000;

export interface AgentTokenIdentity {
  agentId: string;
  ownerSub: string;
  expiresAt: Date;
}

export interface AgentTokenCodec {
  mint(input: { agentId: string; ownerSub: string; ttlMs?: number }): {
    token: string;
    expiresAt: Date;
  };
  /* UNIT_BOUNDARY_DESCRIPTION: the identity a token claims, without asking the store — the api-server still asks the Agent whether that claim is still good at every use. */
  read(token: string, now?: Date): AgentTokenIdentity | null;
}

function sign(hmacKey: string, body: string): Buffer {
  return createHmac("sha256", hmacKey).update(body).digest();
}

export function createAgentTokenCodec(hmacKey: string): AgentTokenCodec {
  if (!hmacKey) {
    throw new Error(
      "agent-tokens: API_KEY_HMAC_KEY must be set — refusing to sign an agent's token without a server-side pepper",
    );
  }

  return {
    mint({ agentId, ownerSub, ttlMs }) {
      const expiresAt = new Date(Date.now() + (ttlMs ?? AGENT_TOKEN_TTL_MS));
      const body = Buffer.from(
        JSON.stringify({
          a: agentId,
          o: ownerSub,
          e: Math.floor(expiresAt.getTime() / 1000),
        }),
      ).toString("base64url");
      const mac = sign(hmacKey, body).toString("base64url");
      return { token: `${AGENT_TOKEN_PREFIX}${body}.${mac}`, expiresAt };
    },

    read(token, now = new Date()) {
      if (!token.startsWith(AGENT_TOKEN_PREFIX)) return null;
      const [body, mac, ...rest] = token
        .slice(AGENT_TOKEN_PREFIX.length)
        .split(".");
      if (body === undefined || mac === undefined || rest.length > 0)
        return null;
      const given = Buffer.from(mac, "base64url");
      const expected = sign(hmacKey, body);
      if (given.length !== expected.length || !timingSafeEqual(given, expected))
        return null;
      let claims: { a?: unknown; o?: unknown; e?: unknown };
      try {
        claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      } catch {
        return null;
      }
      if (
        typeof claims.a !== "string" ||
        typeof claims.o !== "string" ||
        typeof claims.e !== "number"
      )
        return null;
      const expiresAt = new Date(claims.e * 1000);
      if (expiresAt.getTime() <= now.getTime()) return null;
      return { agentId: claims.a, ownerSub: claims.o, expiresAt };
    },
  };
}

export function isAgentToken(token: string): boolean {
  return token.startsWith(AGENT_TOKEN_PREFIX);
}
