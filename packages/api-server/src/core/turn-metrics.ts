import { metrics, type Meter } from "@opentelemetry/api";

const SCOPE = "platform-apiserver";

export const TURN_SURFACES = [
  "ui",
  "cli",
  "other",
  "slack",
  "telegram",
] as const;

export type TurnSurface = (typeof TURN_SURFACES)[number];

export function toTurnSurface(raw: string): TurnSurface {
  return (TURN_SURFACES as readonly string[]).includes(raw)
    ? (raw as TurnSurface)
    : "other";
}

export interface TurnMetrics {
  recordTurn(surface: TurnSurface): void;
}

export function createTurnMetrics(
  meter: Meter = metrics.getMeter(SCOPE),
): TurnMetrics {
  const total = meter.createCounter("platform.turn.total", {
    description: "Turns submitted to an agent, by originating surface",
  });
  return {
    recordTurn(surface) {
      total.add(1, { "platform.turn.surface": surface });
    },
  };
}
