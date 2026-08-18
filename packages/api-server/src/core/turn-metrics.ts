import type { Meter } from "@opentelemetry/api";

export type TurnSurface = "ui" | "cli" | "other" | "slack" | "telegram";

const SURFACES = new Map<string, TurnSurface>([
  ["ui", "ui"],
  ["cli", "cli"],
  ["other", "other"],
  ["slack", "slack"],
  ["telegram", "telegram"],
]);

export function toTurnSurface(raw: string): TurnSurface {
  return SURFACES.get(raw) ?? "other";
}

export interface TurnMetrics {
  recordTurn(surface: TurnSurface): void;
}

export function createTurnMetrics(meter: Meter): TurnMetrics {
  const total = meter.createCounter("platform.turn.total", {
    description: "Turns submitted to an agent, by originating surface",
  });
  return {
    recordTurn(surface) {
      total.add(1, { "platform.turn.surface": surface });
    },
  };
}
