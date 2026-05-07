import type { Context } from "hono";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  LABEL_AGENT_REF,
  LABEL_OWNER,
} from "../../modules/agents/infrastructure/labels.js";

/** Header injected by the paired gateway pod's Envoy on harness-bound
 *  traffic. The route that adds it strips any client-supplied value first
 *  (`request_headers_to_remove` + `OVERWRITE_IF_EXISTS_OR_ADD`), so the
 *  agent cannot forge identity even if it could route around `HTTP_PROXY`.
 *  Trust here is topological: the api-server's harness-port ingress
 *  NetworkPolicy admits only `role=gateway` pods, and the agent's egress
 *  NetworkPolicy admits only the paired gateway — there is no path that
 *  reaches this port without traversing an Envoy filter that owns this
 *  header. */
const INSTANCE_HEADER = "x-platform-instance";

/** Resolved instance metadata. `instanceId` mirrors the URL parameter
 *  after a successful header check; `agentId` and `owner` come from the
 *  instance ConfigMap's labels. */
export interface InstanceIdentity {
  instanceId: string;
  agentId: string;
  owner: string;
}

/**
 * Resolve the calling instance from the trusted `x-platform-instance`
 * header injected by the paired gateway pod's Envoy. Returns null on any
 * mismatch or lookup failure — callers map that to 404. Specifically:
 *
 *   - missing header → null (request did not traverse the gateway)
 *   - header ≠ URL `:id` → null (caller addressing another instance)
 *   - instance ConfigMap missing or unlabeled → null (drift)
 *
 * The header itself is not authenticated cryptographically; trust derives
 * from the NetworkPolicy + Envoy topology described on `INSTANCE_HEADER`.
 */
export async function verifyInstanceFromHeader(
  k8s: K8sClient,
  c: Context,
  instanceId: string,
): Promise<InstanceIdentity | null> {
  const claimed = c.req.header(INSTANCE_HEADER);
  if (!claimed || claimed !== instanceId) return null;

  const instanceCm = await k8s.getConfigMap(instanceId);
  if (!instanceCm) return null;

  const agentId = instanceCm.metadata?.labels?.[LABEL_AGENT_REF];
  const owner = instanceCm.metadata?.labels?.[LABEL_OWNER];
  if (!agentId || !owner) return null;

  return { instanceId, agentId, owner };
}
