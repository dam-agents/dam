/**
 * Reacts to AgentDeleted — removes channel rows and per-channel
 * authorization state from PostgreSQL.
 */
import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentDeleted,
} from "../../../events.js";

export function startChannelCleanupSaga(
  deleteChannelsByAgent: (agentId: string) => Promise<void>,
  deleteTelegramThreadsByAgent: (agentId: string) => Promise<void>,
): Subscription {
  return events$()
    .pipe(
      ofType<AgentDeleted>(EventType.AgentDeleted),
      mergeMap(async (event) => {
        try {
          await deleteChannelsByAgent(event.agentId);
        } catch (err) {
          process.stderr.write(
            `[channel-cleanup] Channels failed for ${event.agentId}: ${err}\n`,
          );
        }
        try {
          await deleteTelegramThreadsByAgent(event.agentId);
        } catch (err) {
          process.stderr.write(
            `[channel-cleanup] Telegram threads failed for ${event.agentId}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
