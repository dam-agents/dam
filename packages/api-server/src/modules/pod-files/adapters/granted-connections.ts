import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import { createAgentGrantsPort } from "../../agents/infrastructure/agent-grants-port.js";
import { createK8sConnectionsPort } from "../../connections/infrastructure/k8s-connections-port.js";

/**
 * Wire `(owner, agentId)` → the set of `RawConnection` rows the pod-files
 * producer layer consumes. Resolves grants from the agent's instance CM
 * annotation and joins them with the owner's connection Secrets.
 *
 * `hostPattern` on each summary becomes `metadata.baseUrl` — the producer's
 * documented input field. Other fields stay namespaced under metadata for
 * forward-compatibility with future producers reading the same shape.
 */
export function createGrantedConnectionsAdapter(
  client: K8sClient,
): (
  owner: string,
  agentId: string,
) => Promise<
  { id: string; provider: string; metadata: Record<string, unknown> }[]
> {
  return async (owner, agentId) => {
    const grants = createAgentGrantsPort(client, owner);
    const { grantedConnectionIds } = await grants.get(agentId);
    if (grantedConnectionIds.length === 0) return [];
    const granted = new Set(grantedConnectionIds);
    const port = createK8sConnectionsPort(client, owner);
    const all = await port.listConnections();
    return all
      .filter((c) => granted.has(c.connection))
      .map((c) => ({
        id: c.connection,
        provider: c.connection,
        metadata: {
          baseUrl: c.hosts[0],
          ...(c.displayName ? { displayName: c.displayName } : {}),
        },
      }));
  };
}
