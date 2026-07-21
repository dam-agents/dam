import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  EventType,
  type ConnectionCreated,
  type ConnectionRemoved,
} from "../../../events.js";
import type { ForksService } from "../services/forks-service.js";

/** A replier's credential set changed — roll their forks' gateways now
 *  (#2843). Waiting for the next turn's activity bump would race the roll
 *  and egress with the stale credential set. */
export function startOnConnectionChangedSaga(
  forks: ForksService,
): Subscription {
  return events$()
    .pipe(
      mergeMap(async (event) => {
        if (
          event.type !== EventType.ConnectionCreated &&
          event.type !== EventType.ConnectionRemoved
        ) {
          return;
        }
        const e = event as ConnectionCreated | ConnectionRemoved;
        try {
          await forks.pokeCredentials(e.actorSub);
        } catch (err) {
          process.stderr.write(
            `[forks/on-connection-changed] ${e.actorSub}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
