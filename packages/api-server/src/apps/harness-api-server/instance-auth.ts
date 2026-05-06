import { createHash } from "node:crypto";
import yaml from "js-yaml";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  LABEL_AGENT_REF,
  LABEL_OWNER,
  STATUS_KEY,
} from "../../modules/agents/infrastructure/labels.js";

/** Resolved instance metadata derived from a successful credential check. */
export interface InstanceIdentity {
  instanceId: string;
  agentId: string;
  owner: string;
}

/**
 * Wire shape for the platform credential the gateway pod's Envoy injects on
 * api-server-bound traffic (issue #108). The token is a 43-char base64url
 * string; the prefix matches the controller's bootstrap template (see
 * `platformCredHeaderValuePrefix` in
 * `packages/controller/pkg/reconciler/platform_cred.go`).
 */
const CREDENTIAL_SCHEME = "PlatformInstance ";

/**
 * Pull the credential off the request's `Authorization` header, validate it
 * against the instance's `platformCredentialHash` (stamped on the instance
 * ConfigMap status by the controller), and return the resolved identity.
 *
 * Returns null on any failure (missing header, wrong scheme, hash mismatch,
 * missing/relabelled instance). Callers map null to 401/404 — the hash is
 * the only authoritative check; pod IP is no longer load-bearing here.
 *
 * Cross-checks:
 *   - Instance ConfigMap exists, carries a non-empty `platformCredentialHash`.
 *   - Agent ConfigMap referenced by the instance carries the same owner —
 *     guards against a relabelled instance pointing at someone else's agent.
 */
export async function verifyInstanceCredential(
  k8s: K8sClient,
  instanceId: string,
  authorizationHeader: string | undefined,
): Promise<InstanceIdentity | null> {
  if (!authorizationHeader || !authorizationHeader.startsWith(CREDENTIAL_SCHEME)) {
    return null;
  }
  const token = authorizationHeader.slice(CREDENTIAL_SCHEME.length).trim();
  if (!token) return null;

  const instanceCm = await k8s.getConfigMap(instanceId);
  if (!instanceCm) return null;

  const agentId = instanceCm.metadata?.labels?.[LABEL_AGENT_REF];
  const owner = instanceCm.metadata?.labels?.[LABEL_OWNER];
  if (!agentId || !owner) return null;

  const statusYaml = instanceCm.data?.[STATUS_KEY];
  if (!statusYaml) return null;
  const status = yaml.load(statusYaml) as { platformCredentialHash?: string };
  const expected = status?.platformCredentialHash;
  if (!expected) return null;

  const actual = createHash("sha256").update(token).digest("hex");
  if (!constantTimeEqualHex(actual, expected)) return null;

  // Owner cross-check via the agent ConfigMap. Issue #108 keeps this
  // because credential validity alone doesn't pin the (instance, agent,
  // owner) triple — a relabelled instance whose `LABEL_AGENT_REF` points
  // at a different owner's agent would otherwise leak that owner's agent
  // services into this instance's MCP session.
  const agentCm = await k8s.getConfigMap(agentId);
  if (!agentCm) return null;
  if (agentCm.metadata?.labels?.[LABEL_OWNER] !== owner) return null;

  return { instanceId, agentId, owner };
}

/**
 * Hex-encoded SHA256 strings are always the same length, so a length-prefixed
 * compare is sufficient for the constant-time guarantee. Avoids pulling in
 * `timingSafeEqual` for a same-length comparison and keeps the call site
 * readable. Using XOR over each pair of characters avoids an early-exit
 * leak through string comparison shortcuts.
 */
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
