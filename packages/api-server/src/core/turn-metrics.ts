import { metrics, type Counter } from "@opentelemetry/api";
import { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type ChannelTurnRelayed,
  type SessionTurnRelayed,
} from "../events.js";
import { getLogger } from "./logger.js";
import { formatError } from "./format-error.js";

const SCOPE = "platform-apiserver";

let counter: Counter | null = null;

function getCounter(): Counter {
  if (!counter) {
    counter = metrics.getMeter(SCOPE).createCounter("platform.turn.total", {
      description: "Turns submitted to an agent, by originating surface",
    });
  }
  return counter;
}

export function recordTurn(surface: string): void {
  getCounter().add(1, { "platform.turn.surface": surface });
}

export function resetTurnMetricsForTest(): void {
  counter = null;
}

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
