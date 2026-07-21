import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type ChannelTurnRelayed,
} from "../../../events.js";
import type { ForksService } from "../services/forks-service.js";

/** Forks are durable (#2843): a relayed turn no longer tears the fork down,
 *  it stamps activity — so the idle window measures from the turn's *end*,
 *  and the controller's two-tier policy (hibernate, then expire) takes it
 *  from there. Bumping a fork that no longer exists is a no-op. */
export function startOnChannelTurnRelayedSaga(
  forks: ForksService,
): Subscription {
  return events$()
    .pipe(
      ofType<ChannelTurnRelayed>(EventType.ChannelTurnRelayed),
      mergeMap(async (event) => {
        // Only successful turns count as activity: bumping on a failure
        // would re-provision pods nobody is using (the ensure at turn
        // start already stamped the attempt).
        if (!event.forkId || event.outcome !== "success") return;
        try {
          await forks.recordActivity(event.forkId);
        } catch (err) {
          process.stderr.write(
            `[forks/on-channel-turn-relayed] ${event.forkId}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
