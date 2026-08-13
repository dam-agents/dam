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
  deleteTelegramConversationsByAgent: (agentId: string) => Promise<void>,
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
          await deleteTelegramConversationsByAgent(event.agentId);
        } catch (err) {
          process.stderr.write(
            `[channel-cleanup] Telegram conversations failed for ${event.agentId}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
