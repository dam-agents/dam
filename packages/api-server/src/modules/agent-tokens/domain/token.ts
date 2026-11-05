import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { AGENT_TOKEN_PREFIX } from "api-server-api";

/* UNIT_BOUNDARY_DESCRIPTION: how long one minted token lives. Short, because
 * every refresh is cheap — the exchange proves the caller is the agent by the
 * handful of mesh hops it takes to reach the harness route — and because a
 * token that leaks out of the machine stops working soon after. */
export const AGENT_TOKEN_TTL_MS = 15 * 60_000;

/* UNIT_BOUNDARY_DESCRIPTION: the HKDF context this token's key is derived
 * under. An assistant's token is a different authority from an API key, so it
 * never signs with the API key's own pepper: one leaked key must not forge the
 * other kind. */
const HKDF_INFO = "platform/agent-obo/v1";

const CLAIM_STRING_MAX = 256;

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

export function createAgentTokenCodec(hmacKey: string): AgentTokenCodec {
  if (!hmacKey) {
    throw new Error(
      "agent-tokens: API_KEY_HMAC_KEY must be set — refusing to sign an agent's token without a server-side pepper",
    );
  }
  const key = Buffer.from(
    hkdfSync("sha256", hmacKey, Buffer.alloc(0), HKDF_INFO, 32),
  );

  function sign(body: string): Buffer {
    return createHmac("sha256", key).update(body).digest();
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
      const mac = sign(body).toString("base64url");
      return { token: `${AGENT_TOKEN_PREFIX}${body}.${mac}`, expiresAt };
    },

    read(token, now = new Date()) {
      if (!token.startsWith(AGENT_TOKEN_PREFIX)) return null;
      const parts = token.slice(AGENT_TOKEN_PREFIX.length).split(".");
      if (parts.length !== 2) return null;
      const [body, mac] = parts as [string, string];
      if (!isCanonicalBase64Url(body) || !isCanonicalBase64Url(mac))
        return null;

      const given = Buffer.from(mac, "base64url");
      const expected = sign(body);
      if (given.length !== expected.length || !timingSafeEqual(given, expected))
        return null;

      const claims = parseClaims(body);
      if (claims === null) return null;
      const expiresAt = new Date(claims.e * 1000);
      if (expiresAt.getTime() <= now.getTime()) return null;
      return { agentId: claims.a, ownerSub: claims.o, expiresAt };
    },
  };
}

/* UNIT_BOUNDARY_DESCRIPTION: one spelling per byte string. A signature that
 * passed over a re-spelled, padded or non-alphabet token would be checked
 * against bytes the sender did not write, so anything but the canonical form is
 * refused before the MAC is read. */
function isCanonicalBase64Url(value: string): boolean {
  if (value === "" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  return Buffer.from(value, "base64url").toString("base64url") === value;
}

function boundedName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= CLAIM_STRING_MAX &&
    !/\p{Cc}/u.test(value)
  );
}

function parseClaims(body: string): { a: string; o: string; e: number } | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded))
    return null;
  const { a, o, e } = decoded as Record<string, unknown>;
  if (!boundedName(a) || !boundedName(o)) return null;
  if (typeof e !== "number" || !Number.isSafeInteger(e) || e <= 0) return null;
  return { a, o, e };
}

export function isAgentToken(token: string): boolean {
  return token.startsWith(AGENT_TOKEN_PREFIX);
}
