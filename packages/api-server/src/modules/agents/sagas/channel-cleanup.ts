import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentDeleted,
} from "../../../events.js";

export function startChannelCleanupSaga(
  deleteChannelsByAgent: (agentId: string) => Promise<string[]>,
  deleteTelegramConversationsByAgent: (agentId: string) => Promise<void>,
  promoteSlackDefault: (slackChannelId: string) => Promise<string | null>,
): Subscription {
  return events$()
    .pipe(
      ofType<AgentDeleted>(EventType.AgentDeleted),
      mergeMap(async (event) => {
        try {
          const released = await deleteChannelsByAgent(event.agentId);
          for (const slackChannelId of released) {
            try {
              await promoteSlackDefault(slackChannelId);
            } catch (err) {
              process.stderr.write(
                `[channel-cleanup] Default promotion failed for ${slackChannelId}: ${err}\n`,
              );
            }
          }
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
