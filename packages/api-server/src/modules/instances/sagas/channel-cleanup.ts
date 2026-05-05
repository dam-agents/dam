/**
 * Reacts to InstanceDeleted — removes channel rows and per-channel
 * authorization state from PostgreSQL.
 */
import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { events$, ofType, EventType, type InstanceDeleted } from "../../../events.js";

export function startChannelCleanupSaga(
  deleteChannelsByInstance: (instanceId: string) => Promise<void>,
  deleteTelegramThreadsByInstance: (instanceId: string) => Promise<void>,
): Subscription {
  return events$().pipe(
    ofType<InstanceDeleted>(EventType.InstanceDeleted),
    mergeMap(async (event) => {
      try {
        await deleteChannelsByInstance(event.instanceId);
      } catch (err) {
        process.stderr.write(`[channel-cleanup] Channels failed for ${event.instanceId}: ${err}\n`);
      }
      try {
        await deleteTelegramThreadsByInstance(event.instanceId);
      } catch (err) {
        process.stderr.write(`[channel-cleanup] Telegram threads failed for ${event.instanceId}: ${err}\n`);
      }
    }),
  ).subscribe();
}
