import type { Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import {
  type SharedGrants,
  sharedConnectionNames,
} from "../domain/shared-access.js";

type SharingResult<T> = Result<T, TransportError | AuthRequiredError>;

export interface SharingService {
  telegramGroups(agentId: string): Promise<readonly string[]>;
  heldGrants(agentId: string): Promise<SharingResult<SharedGrants>>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The reads behind the sharing warning that a
 * command does not make anyway: the Telegram groups an Agent is bound to,
 * none when the deployment has no Telegram bot, and the connections and
 * satellites the Agent holds.
 */
export function createSharingService(deps: {
  trpc: TrpcClient;
}): SharingService {
  return {
    async telegramGroups(agentId) {
      const res = await trpcCall(() =>
        deps.trpc.agents.listTelegramChats.query({ agentId }),
      );
      if (!res.ok) return [];
      return res.value.chats.filter((c) => !c.direct).map((c) => c.title);
    },
    async heldGrants(agentId) {
      return trpcCall(async () => {
        const [granted, connections, satellites] = await Promise.all([
          deps.trpc.connections.getAgentConnections.query({ agentId }),
          deps.trpc.connections.list.query(),
          deps.trpc.satellites.list.query(),
        ]);
        const ids = new Set(granted.connections.map((c) => c.connectionId));
        return {
          connections: sharedConnectionNames(
            connections.filter((c) => ids.has(c.id)),
          ),
          satellites: satellites
            .filter((s) => s.grantedAgentIds.includes(agentId))
            .map((s) => s.name),
        };
      });
    },
  };
}
