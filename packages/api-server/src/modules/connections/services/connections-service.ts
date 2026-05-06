import type {
  AgentAppConnections,
  AppConnectionStatus,
  AppConnectionView,
  ConnectionsService,
} from "api-server-api";
import type { K8sConnectionsPort } from "../infrastructure/k8s-connections-port.js";
import type { AgentGrantsPort } from "../../agents/infrastructure/agent-grants-port.js";
import type { PodFilesPublisher } from "../../pod-files/publisher.js";

/** Minimal port consumed by `setAgentConnections` to insert / revoke
 *  `connection:<id>` egress rules when grants change. */
export interface ConnectionRulesSyncPort {
  syncForAgent(input: {
    agentId: string;
    decidedBy: string;
    grants: Map<string, { hosts: readonly string[] }>;
  }): Promise<void>;
}

export function normalizeStatus(
  raw: string | null | undefined,
): AppConnectionStatus {
  if (!raw) return "connected";
  const v = raw.toLowerCase();
  if (v === "connected" || v === "active") return "connected";
  if (v === "expired") return "expired";
  if (v === "disconnected" || v === "revoked") return "disconnected";
  return "unknown";
}

export function createConnectionsService(deps: {
  port: K8sConnectionsPort;
  /** Per-agent grant store (annotations on the instance ConfigMap). */
  grants: AgentGrantsPort;
  /** Owner sub, also the agents' owner. Required when `podFiles` is set. */
  owner?: string;
  /**
   * Pod-files publisher. When set, every successful grant change triggers a
   * re-publish for `owner`. Sidecar's fill-if-missing merge handles re-grants
   * idempotently. (See 034-pod-files-push.)
   */
  podFiles?: PodFilesPublisher;
  /**
   * Provider → API hosts map (ADR-035). Joined into `AppConnectionView`
   * for UI preview, and used by `setAgentConnections` to drive the
   * connection-rules sync.
   */
  egressHostsByProvider?: ReadonlyMap<string, readonly string[]>;
  /** Egress-rules adapter the composition root supplies. */
  connectionRules?: ConnectionRulesSyncPort;
}): ConnectionsService {
  return {
    async list() {
      const connections = await deps.port.listConnections();
      return connections.map<AppConnectionView>((c) => {
        // Provider is the connection key (host or named-app id) in the K8s
        // model. Without per-provider host metadata the egressHosts join is
        // best-effort — present only when the connection key matches a
        // registered provider in the egress-hosts map.
        const provider = c.connection;
        const hosts = deps.egressHostsByProvider?.get(provider);
        return {
          id: c.connection,
          provider,
          label: c.displayName?.trim() || provider,
          status: normalizeStatus(c.status),
          ...(c.connectedAt ? { connectedAt: c.connectedAt } : {}),
          ...(hosts && hosts.length > 0 ? { egressHosts: [...hosts] } : {}),
        };
      });
    },

    async getAgentConnections(agentId: string): Promise<AgentAppConnections> {
      const g = await deps.grants.get(agentId);
      // No annotation on the instance CM → "all granted" (legacy default).
      // The UI uses connectionIds to show which checkboxes are ticked, so
      // surface every owner connection in that case.
      if (g.grantedConnectionIds === null) {
        const all = await deps.port.listConnections();
        return { connectionIds: all.map((c) => c.connection) };
      }
      return { connectionIds: g.grantedConnectionIds };
    },

    async setAgentConnections(agentId: string, connectionIds: string[]) {
      const deduped = Array.from(new Set(connectionIds));
      await deps.grants.setConnectionGrants(agentId, deduped);

      if (deps.connectionRules && deps.owner) {
        // Sync `connection:<id>` egress rules per granted provider's API
        // hosts (ADR-035). Providers without a registry entry just
        // contribute zero hosts — the sync still revokes any stale rows.
        const all = await deps.port.listConnections();
        const grants = new Map<string, { hosts: readonly string[] }>();
        for (const c of all) {
          if (!deduped.includes(c.connection)) continue;
          const hosts = deps.egressHostsByProvider?.get(c.connection) ?? [];
          if (hosts.length === 0) continue;
          grants.set(c.connection, { hosts });
        }
        await deps.connectionRules.syncForAgent({
          agentId,
          decidedBy: deps.owner,
          grants,
        });
      }
      if (deps.podFiles && deps.owner) {
        await deps.podFiles.publishForOwner(deps.owner, agentId, "app-connections");
      }
    },
  };
}
