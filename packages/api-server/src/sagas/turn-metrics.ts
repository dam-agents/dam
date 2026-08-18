import { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type ChannelTurnRelayed,
  type SessionTurnRelayed,
} from "../events.js";
import { getLogger } from "../core/logger.js";
import { formatError } from "../core/format-error.js";
import { recordTurn } from "../core/turn-metrics.js";

export function startTurnMetricsSaga(): Subscription {
  const sub = new Subscription();

  function on<T extends ChannelTurnRelayed | SessionTurnRelayed>(
    type: T["type"],
    surfaceOf: (event: T) => string,
  ): void {
    sub.add(
      events$()
        .pipe(ofType<T>(type))
        .subscribe((event) => {
          try {
            recordTurn(surfaceOf(event));
          } catch (err) {
            getLogger().error(
              { sourceEvent: type, reason: formatError(err) },
              "turn_metrics.saga_error",
            );
          }
        }),
    );
  }

  on<SessionTurnRelayed>(EventType.SessionTurnRelayed, (e) => e.surface);
  on<ChannelTurnRelayed>(EventType.ChannelTurnRelayed, (e) => e.channel);

  return sub;
}
