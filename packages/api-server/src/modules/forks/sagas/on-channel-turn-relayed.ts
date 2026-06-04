import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type ChannelTurnRelayed,
} from "../../../events.js";
import type { ForksService } from "../services/forks-service.js";

export function startOnChannelTurnRelayedSaga(
  forks: ForksService,
): Subscription {
  return events$()
    .pipe(
      ofType<ChannelTurnRelayed>(EventType.ChannelTurnRelayed),
      mergeMap(async (event) => {
        if (!event.forkId) return;
        try {
          await forks.closeFork(event.forkId);
        } catch (err) {
          process.stderr.write(
            `[forks/on-channel-turn-relayed] ${event.forkId}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
