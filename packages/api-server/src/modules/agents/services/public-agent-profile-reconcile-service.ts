import type { PublicAgentProfileRow } from "../infrastructure/public-agent-profile-repository.js";
import type { PublicAgentIdentity } from "./public-agent-page-service.js";

export interface PublicAgentProfileReconcileResult {
  scanned: number;
  refreshed: number;
  deleted: number;
  failed: number;
}

export interface PublicAgentProfileReconcileService {
  reconcile(): Promise<PublicAgentProfileReconcileResult>;
}

export interface PublicAgentProfileReconcileDeps {
  listProfileIds: () => Promise<string[]>;
  readAgent: (agentId: string) => Promise<PublicAgentIdentity | null>;
  upsertProfile: (row: PublicAgentProfileRow) => Promise<void>;
  markProfileDeleted: (agentId: string) => Promise<void>;
  log: (message: string) => void;
}

export function createPublicAgentProfileReconcileService(
  deps: PublicAgentProfileReconcileDeps,
): PublicAgentProfileReconcileService {
  return {
    async reconcile() {
      let agentIds: string[];
      try {
        agentIds = await deps.listProfileIds();
      } catch (err) {
        deps.log(
          `listing profiles failed, will retry next tick: ${String(err)}`,
        );
        return { scanned: 0, refreshed: 0, deleted: 0, failed: 1 };
      }

      let refreshed = 0;
      let deleted = 0;
      let failed = 0;
      for (const agentId of agentIds) {
        try {
          const agent = await deps.readAgent(agentId);
          if (agent) {
            await deps.upsertProfile({
              agentId,
              name: agent.name,
              ownerSub: agent.ownerSub,
            });
            refreshed++;
          } else {
            await deps.markProfileDeleted(agentId);
            deleted++;
          }
        } catch (err) {
          failed++;
          deps.log(`refreshing agent ${agentId} failed: ${String(err)}`);
        }
      }
      return { scanned: agentIds.length, refreshed, deleted, failed };
    },
  };
}
