import type { DayCounter } from "./ledger.js";
import type { SpendUnit } from "./units.js";

export type LimitScope = { readonly kind: "agent"; readonly agentId: string };

export type LimitState = "ok" | "warn" | "reached";

export interface SpendLimit {
  readonly id: string;
  readonly ownerSub: string;
  readonly scope: LimitScope;
  readonly unit: SpendUnit;
  readonly amountMicros: number;
  readonly extensions: number;
}

export interface LimitReading {
  readonly limit: SpendLimit;
  readonly effectiveMicros: number;
  readonly spentMicros: number;
  readonly leftMicros: number;
  readonly state: LimitState;
}

const WARN_SHARE = 0.8;

export function effectiveMicros(limit: SpendLimit): number {
  return limit.amountMicros * (limit.extensions + 1);
}

export function limitState(spentMicros: number, effective: number): LimitState {
  if (spentMicros >= effective) return "reached";
  if (spentMicros >= effective * WARN_SHARE) return "warn";
  return "ok";
}

export function readLimit(
  limit: SpendLimit,
  spentMicros: number,
): LimitReading {
  const effective = effectiveMicros(limit);
  return {
    limit,
    effectiveMicros: effective,
    spentMicros,
    leftMicros: Math.max(0, effective - spentMicros),
    state: limitState(spentMicros, effective),
  };
}

export function limitCounter(limit: SpendLimit, day: string): DayCounter {
  return {
    scope: "agent",
    day,
    agentId: limit.scope.agentId,
    unit: limit.unit,
  };
}

export function limitsOnCall(
  limits: readonly SpendLimit[],
  call: { readonly payer: string; readonly unit: SpendUnit },
): SpendLimit[] {
  if (call.unit === "free") return [];
  return limits.filter(
    (limit) => limit.scope.agentId === call.payer && limit.unit === call.unit,
  );
}
