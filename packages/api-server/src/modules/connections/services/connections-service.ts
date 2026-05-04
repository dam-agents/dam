import type {
  AgentAppConnections,
  AppConnectionStatus,
  AppConnectionView,
  ConnectionsService,
} from "api-server-api";
import type { OnecliConnectionsPort } from "../infrastructure/onecli-connections-port.js";
import type { PodFilesPublisher } from "../../pod-files/publisher.js";

/** Minimal port consumed by `setAgentConnections` to insert / revoke
 *  `connection:<id>` egress rules when grants change. Mirrors the
 *  `ConnectionRulesSync` interface in the egress-rules module without
 *  importing across module boundaries; the composition root supplies the
 *  structurally-compatible adapter. */
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
  if (v === "connected") return "connected";
  if (v === "expired") return "expired";
  if (v === "disconnected" || v === "revoked") return "disconnected";
  // Unrecognized status: don't show a green "Connected" badge on a state we
  // can't vouch for (e.g. a future "pending" or "syncing" OneCLI status).
  return "unknown";
}

/**
 * Keys are tried in this order because:
 *   - `email`: most providers' canonical user identifier (Google, Microsoft)
 *   - `login`/`username`/`handle`: GitHub / GitLab / Slack-style handles
 *   - `name`: display name (less precise; last resort before `account`)
 *   - `account`: generic fallback some providers use
 */
export function extractIdentity(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!metadata) return undefined;
  for (const key of ["email", "login", "username", "handle", "name", "account"]) {
    const v = metadata[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export function createConnectionsService(deps: {
  port: OnecliConnectionsPort;
  /**
   * The Keycloak sub of the user calling setAgentConnections (also the
   * agent's owner — only owners can grant). Required when `podFiles` is
   * present so the publisher knows which owner's state to read.
   */
  owner?: string;
  /**
   * Optional pod-files publisher. When set, every successful grant change
   * triggers a re-publish of all producers' output for `owner`. The
   * sidecar's fill-if-missing merge handles re-grants idempotently, so we
   * always send the full current state — no diff computation. Revokes
   * trigger nothing (entries linger; see 034-pod-files-push).
   */
  podFiles?: PodFilesPublisher;
  /**
   * Provider → API hosts map (ADR-035). Loaded once at boot
   * from the operator-owned ConfigMap. Joined into `AppConnectionView`
   * for UI preview, and used by `setAgentConnections` to drive the
   * connection-rules sync. Empty/missing for a provider → that provider's
   * grants don't add egress rules.
   */
  egressHostsByProvider?: ReadonlyMap<string, readonly string[]>;
  /**
   * Egress-rules adapter the composition root supplies. When present,
   * `setAgentConnections` syncs `connection:<id>` rules alongside the
   * OneCLI grant write — same atomic-on-server pattern as `setAgentAccess`.
   */
  connectionRules?: ConnectionRulesSyncPort;
}): ConnectionsService {
  return {
    async list() {
      // OneCLI returns `providerName` and `envMappings` joined from the app
      // registry — provider-specific knowledge lives there, not here.
      // `egressHosts` is sourced from our own ConfigMap and joined by
      // `provider` so the UI can preview connection-derived rules and
      // `setAgentConnections` can sync them.
      const raw = await deps.port.listAppConnections();
      return raw
        .filter((c) => typeof c.id === "string" && typeof c.provider === "string")
        .map<AppConnectionView>((c) => {
          const hosts = deps.egressHostsByProvider?.get(c.provider);
          return {
            id: c.id,
            provider: c.provider,
            label: c.providerName?.trim() || c.label?.trim() || c.provider,
            status: normalizeStatus(c.status),
            identity: extractIdentity(c.metadata) || c.label?.trim() || undefined,
            ...(c.scopes ? { scopes: c.scopes } : {}),
            ...(c.connectedAt ? { connectedAt: c.connectedAt } : {}),
            ...(c.envMappings && c.envMappings.length > 0
              ? { envMappings: c.envMappings }
              : {}),
            ...(hosts && hosts.length > 0 ? { egressHosts: [...hosts] } : {}),
          };
        });
    },

    async getAgentConnections(agentId: string): Promise<AgentAppConnections> {
      const agent = await deps.port.findAgentByIdentifier(agentId);
      if (!agent) {
        // Agent may not be registered in OneCLI yet (controller sync is async).
        return { connectionIds: [] };
      }
      const connectionIds = await deps.port.getAgentAppConnectionIds(agent.id);
      return { connectionIds };
    },

    async setAgentConnections(agentId: string, connectionIds: string[]) {
      const agent = await deps.port.findAgentByIdentifier(agentId);
      // Write path fails loud when the agent isn't synced to OneCLI yet:
      // a silent no-op would confuse users who just checked a box.
      if (!agent) throw new Error(`Agent "${agentId}" not found in OneCLI`);
      const deduped = Array.from(new Set(connectionIds));
      await deps.port.setAgentAppConnectionIds(agent.id, deduped);

      // Sync connection-derived egress rules so granting/ungranting an
      // app produces the same atomic rule update that `setAgentAccess`
      // delivers for secrets. Providers without a registry entry just
      // contribute zero hosts — the sync still revokes any stale rows.
      if (deps.connectionRules && deps.owner && deps.egressHostsByProvider) {
        const all = await deps.port.listAppConnections();
        const grants = new Map<string, { hosts: readonly string[] }>();
        for (const c of all) {
          if (!deduped.includes(c.id)) continue;
          const hosts = deps.egressHostsByProvider.get(c.provider) ?? [];
          if (hosts.length === 0) continue;
          grants.set(c.id, { hosts });
        }
        await deps.connectionRules.syncForAgent({
          agentId,
          decidedBy: deps.owner,
          grants,
        });
      }

      // Re-run pod-files producers tagged with "app-connections" and
      // publish to the agent's sidecar. Source-tagged so unrelated
      // producers (secrets, schedules, …) don't run on every grant change.
      if (deps.podFiles && deps.owner) {
        await deps.podFiles.publishForOwner(
          deps.owner,
          agentId,
          "app-connections",
        );
      }
    },
  };
}
