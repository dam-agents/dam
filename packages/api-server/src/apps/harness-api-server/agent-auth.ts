import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  LABEL_TYPE,
  LABEL_OWNER,
  TYPE_AGENT,
} from "../../modules/agents/infrastructure/labels.js";

/** Resolved agent metadata. `agentId` mirrors the URL parameter after a
 *  successful resolution; `owner` comes from the Agent ConfigMap's labels. */
export interface AgentIdentity {
  agentId: string;
  owner: string;
}

/**
 * Resolve the calling agent from the URL `:id`.
 *
 * ADR-041: identity is enforced at the Istio waypoint via a per-agent
 * AuthorizationPolicy that ALLOWs only principal `<td>/ns/<agent-ns>/sa/<id>`
 * to path `/api/agents/<id>/*`. By the time a request reaches this handler
 * the URL `:id` is already authenticated — the application does not parse
 * XFCC and does not consult any header.
 *
 * Returns null when the Agent ConfigMap is missing, the type label is wrong
 * (drift), or the owner label is missing; callers map that to 404.
 */
export async function resolveAgent(
  k8s: K8sClient,
  agentId: string,
): Promise<AgentIdentity | null> {
  const cm = await k8s.getConfigMap(agentId);
  if (!cm) return null;
  if (cm.metadata?.labels?.[LABEL_TYPE] !== TYPE_AGENT) return null;
  const owner = cm.metadata?.labels?.[LABEL_OWNER];
  if (!owner) return null;

  return { agentId, owner };
}
