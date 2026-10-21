import { concatMap, type Subscription } from "rxjs";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  events$,
  EventType,
  ofType,
  type AgentResourceRemoved,
} from "../../../events.js";
import type { LastKnownNames } from "../infrastructure/last-known-names.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A spend ledger row outlives its agent, so the
 * spend screens keep the name the Agent resource had when it went. Every
 * replica's watch emits the event, and the write is an upsert on the agent
 * id, so each replica and each replay leave one row.
 */
export function startKeepLastKnownNameSaga(deps: {
  names: LastKnownNames;
}): Subscription {
  return events$()
    .pipe(
      ofType<AgentResourceRemoved>(EventType.AgentResourceRemoved),
      concatMap(async (event) => {
        try {
          await deps.names.keep({
            agentId: event.agentId,
            ownerSub: event.ownerSub,
            name: event.name,
            removedAt: new Date(),
          });
        } catch (err) {
          getLogger().error(
            { agentId: event.agentId, reason: formatError(err) },
            "spend.agent_name_keep_failed",
          );
        }
      }),
    )
    .subscribe();
}
