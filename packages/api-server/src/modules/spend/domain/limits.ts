import { match } from "ts-pattern";
import type { DayCounter } from "./ledger.js";
import type { SpendUnit } from "./units.js";

export type LimitScope =
  | { readonly kind: "agent"; readonly agentId: string }
  | { readonly kind: "owner" }
  | {
      readonly kind: "connection";
      readonly agentId: string;
      readonly connectionId: string;
    };

export type LimitState = "ok" | "warn" | "reached";

export interface SpendLimit {
  readonly id: string;
  readonly ownerSub: string;
  readonly scope: LimitScope;
  readonly unit: SpendUnit;
  readonly amountMicros: number;
  readonly extensions: number;
}

export interface SpendCeiling {
  readonly amountMicros: number;
  readonly source: "default" | "UserSpendLimit";
}

export interface LimitReading {
  readonly limit: SpendLimit;
  readonly effectiveMicros: number;
  readonly spentMicros: number;
  readonly leftMicros: number;
  readonly state: LimitState;
}

export interface CeilingReading {
  readonly ceiling: SpendCeiling;
  readonly spentMicros: number;
  readonly state: LimitState;
}

export interface LimitedCall {
  readonly payer: string;
  readonly ownerSub: string;
  readonly connectionId: string | null;
  readonly unit: SpendUnit;
}

export type SpendBlock = "ceiling" | "limit";

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

export function readCeiling(
  ceiling: SpendCeiling,
  spentMicros: number,
): CeilingReading {
  return {
    ceiling,
    spentMicros,
    state: limitState(spentMicros, ceiling.amountMicros),
  };
}

export function limitCounter(limit: SpendLimit, day: string): DayCounter {
  return match(limit.scope)
    .with({ kind: "agent" }, (scope): DayCounter => ({
      scope: "agent",
      day,
      agentId: scope.agentId,
      unit: limit.unit,
    }))
    .with({ kind: "owner" }, (): DayCounter => ({
      scope: "owner",
      day,
      ownerSub: limit.ownerSub,
      unit: limit.unit,
    }))
    .with({ kind: "connection" }, (scope): DayCounter => ({
      scope: "connection",
      day,
      agentId: scope.agentId,
      connectionId: scope.connectionId,
    }))
    .exhaustive();
}

export function ceilingCounter(ownerSub: string, day: string): DayCounter {
  return { scope: "owner", day, ownerSub, unit: "usd" };
}

export function countsInCeiling(unit: SpendUnit): boolean {
  return unit === "usd";
}

export function limitsOnCall(
  limits: readonly SpendLimit[],
  call: LimitedCall,
): SpendLimit[] {
  if (call.unit === "free") return [];
  return limits.filter(
    (limit) =>
      limit.unit === call.unit &&
      match(limit.scope)
        .with({ kind: "agent" }, (scope) => scope.agentId === call.payer)
        .with({ kind: "owner" }, () => limit.ownerSub === call.ownerSub)
        .with(
          { kind: "connection" },
          (scope) =>
            scope.agentId === call.payer &&
            scope.connectionId === call.connectionId,
        )
        .exhaustive(),
  );
}

export function blockOf(
  ceiling: CeilingReading | null,
  limits: readonly LimitReading[],
): SpendBlock | null {
  if (ceiling?.state === "reached") return "ceiling";
  if (limits.some((reading) => reading.state === "reached")) return "limit";
  return null;
}
