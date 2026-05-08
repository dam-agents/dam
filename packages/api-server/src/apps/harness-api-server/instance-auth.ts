import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  LABEL_AGENT_REF,
  LABEL_OWNER,
} from "../../modules/agents/infrastructure/labels.js";

/** Resolved instance metadata. `instanceId` mirrors the URL parameter
 *  after a successful resolution; `agentId` and `owner` come from the
 *  instance ConfigMap's labels. */
export interface InstanceIdentity {
  instanceId: string;
  agentId: string;
  owner: string;
}

/**
 * Resolve the calling instance from the URL `:id`.
 *
 * ADR-041: identity is enforced at the Istio waypoint via a per-instance
 * AuthorizationPolicy that ALLOWs only principal `<td>/ns/<agent-ns>/sa/<id>`
 * to path `/api/instances/<id>/*`. By the time a request reaches this
 * handler the URL `:id` is already authenticated — the application
 * does not parse XFCC and does not consult any header.
 *
 * Returns null when the instance ConfigMap is missing or unlabeled
 * (drift); callers map that to 404.
 */
export async function resolveInstance(
  k8s: K8sClient,
  instanceId: string,
): Promise<InstanceIdentity | null> {
  const instanceCm = await k8s.getConfigMap(instanceId);
  if (!instanceCm) return null;

  const agentId = instanceCm.metadata?.labels?.[LABEL_AGENT_REF];
  const owner = instanceCm.metadata?.labels?.[LABEL_OWNER];
  if (!agentId || !owner) return null;

  return { instanceId, agentId, owner };
}
