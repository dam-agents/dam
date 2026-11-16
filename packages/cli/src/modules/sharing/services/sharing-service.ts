import type { TelegramChatAudience } from "api-server-api";
import { ok, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import {
  classifyTrpcError,
  trpcCall,
  trpcErrorCode,
} from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import {
  type SharedGrants,
  sharedConnectionNames,
} from "../domain/shared-access.js";

type SharingResult<T> = Result<T, TransportError | AuthRequiredError>;

export interface SharingService {
  telegramChats(
    agentId: string,
  ): Promise<SharingResult<readonly TelegramChatAudience[]>>;
  heldGrants(agentId: string): Promise<SharingResult<SharedGrants>>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The reads behind the sharing warning that a
 * command does not make anyway: the Telegram chats an Agent is bound to,
 * none when the deployment has no Telegram bot, and the connections and
 * satellites the Agent holds. A failed read is an error, never an empty list,
 * so the command can say it could not check.
 */
export function createSharingService(deps: {
  trpc: TrpcClient;
}): SharingService {
  return {
    async telegramChats(agentId) {
      try {
        const { chats } = await deps.trpc.agents.listTelegramChats.query({
          agentId,
        });
        return ok(chats);
      } catch (e) {
        if (trpcErrorCode(e) === "PRECONDITION_FAILED") return ok([]);
        return classifyTrpcError(e);
      }
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
