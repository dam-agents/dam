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
  /**
   * OAuth app registry. Connection egress hosts come from two sources:
   *   - Static descriptors (`descriptor.egressHosts`) for github, spotify,
   *     and the Google services — co-located with the descriptor itself.
   *   - The connection's stored `(hostPattern, pathPattern)` metadata for
   *     dynamic-host apps (Generic OAuth, GitHub Enterprise) where the
   *     host is a user-supplied input at connect time.
   * Replaces the previous helm-mounted provider→hosts map (ADR-035).
   */
  apps?: OAuthAppRegistry;
  /** Egress-rules adapter the composition root supplies. */
  connectionRules?: ConnectionRulesSyncPort;
}): ConnectionsService {
  // Resolve a connection's egress host rules. Static descriptors declare
  // `egressHosts`; dynamic-host apps (Generic, GHE) leave it undefined and
  // we fall back to the connection's stored hostPattern/pathPattern.
  function rulesFor(
    summary: { connection: string; hostPattern: string },
    record: { metadata?: { hostPattern: string; pathPattern?: string } } | null,
  ): { host: string; pathPattern?: string }[] {
    const descriptor = deps.apps?.list().find((a) => matchesAppConnection(a, summary.connection));
    if (descriptor?.egressHosts && descriptor.egressHosts.length > 0) {
      return descriptor.egressHosts.map((r) => ({ ...r }));
    }
    const host = record?.metadata?.hostPattern ?? summary.hostPattern;
    if (!host) return [];
    const pathPattern = record?.metadata?.pathPattern;
    return [pathPattern ? { host, pathPattern } : { host }];
  }

  return {
    async list() {
      const connections = await deps.port.listConnections();
      // UI preview takes hostnames only — the path-pattern detail lives on
      // the rendered egress rules, not the connection summary. Pull from
      // descriptor.egressHosts where available; for dynamic-host apps the
      // summary already carries the host that user supplied at connect
      // time, so no extra K8s round-trip is needed.
      return connections.map<AppConnectionView>((c) => {
        const provider = c.connection;
        const rules = rulesFor(c, null);
        const hostnames = Array.from(new Set(rules.map((r) => r.host)));
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
        // Sync `connection:<id>` egress rules per granted provider's API
        // host rules (ADR-035). Resolution order per connection:
        //   1. `descriptor.egressHosts` — static apps (github, spotify,
        //      Google services) declare their canonical hosts.
        //   2. The connection's stored `(hostPattern, pathPattern)` —
        //      dynamic-host apps (Generic, GHE) where the host is user
        //      input. Pulled via `getConnection` which loads the full
        //      record (one round-trip per granted dynamic-host conn).
        const all = await deps.port.listConnections();
        const grants = new Map<string, { hosts: readonly { host: string; pathPattern?: string }[] }>();
        for (const c of all) {
          if (!deduped.includes(c.connection)) continue;
          const descriptor = deps.apps
            ?.list()
            .find((a) => matchesAppConnection(a, c.connection));
          let hosts = descriptor?.egressHosts
            ? descriptor.egressHosts.map((r) => ({ ...r }))
            : [];
          if (hosts.length === 0) {
            // Dynamic-host fallback — read the connection's user-supplied
            // host from K8s metadata.
            const record = await deps.port.getConnection(c.connection);
            hosts = rulesFor(c, record);
          }
          if (hosts.length === 0) continue;
          grants.set(c.connection, { hosts });
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
