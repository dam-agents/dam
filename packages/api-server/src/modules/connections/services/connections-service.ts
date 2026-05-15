import type {
  AgentAppConnections,
  AppConnectionStatus,
  AppConnectionView,
  ConnectionsService,
} from "api-server-api";
import type { K8sConnectionsPort } from "../infrastructure/k8s-connections-port.js";
import type { AgentGrantsPort } from "../../agents/infrastructure/agent-grants-port.js";
import type { PodFilesPublisher } from "../../pod-files/publisher.js";
import {
  matchesAppConnection,
  type OAuthAppRegistry,
} from "../infrastructure/oauth-apps.js";

/** Minimal port consumed by `setAgentConnections` to insert / revoke
 *  `connection:<id>` egress rules when grants change. */
export interface ConnectionRulesSyncPort {
  syncForAgent(input: {
    agentId: string;
    decidedBy: string;
    grants: Map<string, { hosts: readonly { host: string; pathPattern?: string }[] }>;
    /** Connection IDs the caller owns; rules from sibling modules stay
     *  untouched. See `ConnectionRulesSync` for full semantics. */
    ownedSourceIds: ReadonlySet<string>;
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
  /** OAuth app registry. Used at grant time to resolve a connection to its
   *  static-descriptor host list without a K8s read. Dynamic-host apps
   *  (Generic, GHE) fall through to `getConnection`. */
  apps?: OAuthAppRegistry;
  /** Egress-rules adapter the composition root supplies. */
  connectionRules?: ConnectionRulesSyncPort;
}): ConnectionsService {
  return {
    async list() {
      const connections = await deps.port.listConnections();
      // Hosts authoritative on the stored connection; no descriptor lookup.
      return connections.map<AppConnectionView>((c) => {
        const provider = c.connection;
        const hostnames = Array.from(new Set(c.hosts));
        return {
          id: c.connection,
          provider,
          label: c.displayName?.trim() || provider,
          status: normalizeStatus(c.status),
          ...(c.connectedAt ? { connectedAt: c.connectedAt } : {}),
          ...(hostnames.length > 0 ? { egressHosts: hostnames } : {}),
        };
      });
    },

    async getAgentConnections(agentId: string): Promise<AgentAppConnections> {
      const g = await deps.grants.get(agentId);
      return { connectionIds: g.grantedConnectionIds };
    },

    async setAgentConnections(agentId: string, connectionIds: string[]) {
      const deduped = Array.from(new Set(connectionIds));
      await deps.grants.setConnectionGrants(agentId, deduped);

      if (deps.connectionRules && deps.owner) {
        // Egress rules per granted connection (ADR-035). Two paths:
        //   1. Static descriptor (github, spotify, Google) — host list is
        //      a property of the API, declared in code. Read from
        //      `descriptor.hosts` in memory; no K8s round-trip.
        //   2. Dynamic descriptor (Generic, GHE) — host is user input at
        //      connect time. Read from the connection's stored
        //      `metadata.hosts` via `getConnection`.
        const grants = new Map<string, { hosts: readonly { host: string; pathPattern?: string }[] }>();
        const all = await deps.port.listConnections();
        for (const summary of all) {
          if (!deduped.includes(summary.connection)) continue;
          const descriptor = deps.apps
            ?.list()
            .find((a) => matchesAppConnection(a, summary.connection));
          let hosts: { host: string; pathPattern?: string }[] = descriptor?.hosts
            ? descriptor.hosts.map((h) => ({
                host: h.host,
                ...(h.pathPattern ? { pathPattern: h.pathPattern } : {}),
              }))
            : [];
          if (hosts.length === 0) {
            const record = await deps.port.getConnection(summary.connection);
            if (!record) continue;
            hosts = record.metadata.hosts.map((h) => ({
              host: h.host,
              ...(h.pathPattern ? { pathPattern: h.pathPattern } : {}),
            }));
          }
          if (hosts.length === 0) continue;
          grants.set(summary.connection, { hosts });
        }
        // ownedSourceIds = every connection id the user owns. Lets the
        // sync revoke this module's rows without touching secret-derived
        // rules that share the `connection:<id>` source prefix.
        const ownedSourceIds = new Set(all.map((c) => c.connection));
        await deps.connectionRules.syncForAgent({
          agentId,
          decidedBy: deps.owner,
          grants,
          ownedSourceIds,
        });
      }
      if (deps.podFiles && deps.owner) {
        await deps.podFiles.publishForOwner(deps.owner, agentId, "app-connections");
      }
    },
  };
}
