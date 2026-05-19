import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type SlackTurnRelayed,
} from "../../../events.js";
import type { ForksService } from "../services/forks-service.js";

export function startOnSlackTurnRelayedSaga(forks: ForksService): Subscription {
  return events$()
    .pipe(
      ofType<SlackTurnRelayed>(EventType.SlackTurnRelayed),
      mergeMap(async (event) => {
        if (!event.forkId) return;
        try {
          await forks.closeFork(event.forkId);
        } catch (err) {
          process.stderr.write(
            `[forks/on-slack-turn-relayed] ${event.forkId}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
