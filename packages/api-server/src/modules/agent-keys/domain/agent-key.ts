import { createHmac, randomBytes } from "node:crypto";

// UNIT_BOUNDARY_DESCRIPTION: an Agent Key's prefix: the key an Agent's gateway sends to the Environment gate, never held by the Agent itself.
export const AGENT_KEY_PREFIX = "ak_";

// UNIT_BOUNDARY_DESCRIPTION: the request header the gateway carries the key in; the Go controller renders the same literal, and the gate strips it before anything reaches an Environment's app.
export const AGENT_KEY_HEADER = "x-platform-agent-key";

// UNIT_BOUNDARY_DESCRIPTION: the label and secret type of an Agent Key Secret, which the Go controller reads to mount it on that Agent's gateway alone.
export const SECRET_TYPE_AGENT_KEY = "agent-key";

const RANDOM_BYTES = 32;

export interface AgentKeyCodec {
  mint(): { key: string; hash: string };
  hash(key: string): string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Mints and hashes Agent Keys the way API keys
 * are: 32 random bytes with a prefix, hashed with the install's API key
 * pepper, so the database holds no key a reader of it could send.
 */
export function createAgentKeyCodec(hmacKey: string): AgentKeyCodec {
  if (!hmacKey)
    throw new Error(
      "agent-keys: API_KEY_HMAC_KEY must be set — refusing to hash keys without a server-side pepper",
    );
  const hash = (key: string) =>
    createHmac("sha256", hmacKey).update(key).digest("hex");
  return {
    mint() {
      const key =
        AGENT_KEY_PREFIX + randomBytes(RANDOM_BYTES).toString("base64url");
      return { key, hash: hash(key) };
    },
    hash,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: whether a header value has an Agent Key's shape, checked before any lookup so a stray value costs no query.
export function isAgentKey(value: string | undefined): value is string {
  return value !== undefined && /^ak_[A-Za-z0-9_-]{43}$/.test(value);
}

// UNIT_BOUNDARY_DESCRIPTION: the Agent Key Secret's name, one per Agent; agent ids are DNS labels, so the name is one too.
export function agentKeySecretName(agentId: string): string {
  return `${agentId}-agent-key`;
}

// UNIT_BOUNDARY_DESCRIPTION: the environments domain the key is sent to, as the gateway's chain and the egress rule both name it.
export function environmentsWildcard(domain: string): string {
  return `*.${domain.toLowerCase()}`;
}

// UNIT_BOUNDARY_DESCRIPTION: the file Envoy's credential injector reads, the same SDS shape a connection's credential file has; its whole value is the header's value.
export function agentKeySds(key: string): string {
  return [
    "resources:",
    '- "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret',
    "  name: credential",
    "  generic_secret:",
    "    secret:",
    `      inline_string: ${JSON.stringify(key)}`,
    "",
  ].join("\n");
}
