import { metrics, type Counter } from "@opentelemetry/api";

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
