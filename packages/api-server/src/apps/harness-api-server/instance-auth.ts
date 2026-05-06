import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  LABEL_AGENT_REF,
  LABEL_OWNER,
} from "../../modules/agents/infrastructure/labels.js";

/**
 * Resolved instance metadata for an inbound harness-port request whose peer
 * principal has already been verified by the peer-identity middleware
 * (ADR-039: Istio ambient mTLS).
 */
export interface InstanceIdentity {
  instanceId: string;
  agentId: string;
  owner: string;
}

/**
 * Resolve `(agentId, owner)` for an instance ID extracted from the verified
 * peer principal. Returns null when the instance ConfigMap is missing or its
 * labels are inconsistent — callers map that to 404.
 *
 * Cross-checks owner on both ConfigMaps so a relabelled instance whose
 * `LABEL_AGENT_REF` points at another owner's agent can't borrow that
 * agent's owner identity for downstream services.
 */
export async function resolveInstanceIdentity(
  k8s: K8sClient,
  instanceId: string,
): Promise<InstanceIdentity | null> {
  const instanceCm = await k8s.getConfigMap(instanceId);
  if (!instanceCm) return null;

  const agentId = instanceCm.metadata?.labels?.[LABEL_AGENT_REF];
  const owner = instanceCm.metadata?.labels?.[LABEL_OWNER];
  if (!agentId || !owner) return null;

  const agentCm = await k8s.getConfigMap(agentId);
  if (!agentCm) return null;
  if (agentCm.metadata?.labels?.[LABEL_OWNER] !== owner) return null;

  return { instanceId, agentId, owner };
}
