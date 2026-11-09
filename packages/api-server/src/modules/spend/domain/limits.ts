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
    }
  | { readonly kind: "owner-connection"; readonly connectionId: string };

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
  readonly source: "default" | "operator";
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

export type SpendHoldReason = SpendBlock;

export type OwnerToldWork =
  | { readonly kind: "schedule" }
  | { readonly kind: "ambient"; readonly channel: "slack" | "telegram" }
  | { readonly kind: "mention"; readonly channel: "slack" | "telegram" };

// UNIT_BOUNDARY_DESCRIPTION: the question every gate asks before it starts work for an Agent — may this spend today? — answered with the limit that holds it, or null to go ahead. A gate whose hold the owner must hear about, because nobody who can lift the limit is watching, names the work in `tellOwner`.
export type SpendHoldGate = (input: {
  agentId: string;
  connectionId?: string;
  tellOwner?: OwnerToldWork;
}) => Promise<SpendHoldReason | null>;

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
    .with({ kind: "owner-connection" }, (scope): DayCounter => ({
      scope: "owner-connection",
      day,
      ownerSub: limit.ownerSub,
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
        .with(
          { kind: "owner-connection" },
          (scope) =>
            limit.ownerSub === call.ownerSub &&
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

export type SpendLevel =
  | { readonly kind: "ceiling"; readonly amountMicros: number }
  | {
      readonly kind: "limit";
      readonly limitId: string;
      readonly scope: LimitScope;
      readonly unit: SpendUnit;
      readonly amountMicros: number;
      readonly extensions: number;
    };

export interface NearLevel {
  readonly level: SpendLevel;
  readonly spentMicros: number;
  readonly effectiveMicros: number;
}

export interface SpendStop {
  readonly level: SpendLevel;
  readonly near: readonly NearLevel[];
}

const SCOPE_RANK: Readonly<Record<LimitScope["kind"], number>> = {
  connection: 0,
  agent: 1,
  "owner-connection": 2,
  owner: 3,
};

function levelOfLimit({ limit }: LimitReading): SpendLevel {
  return {
    kind: "limit",
    limitId: limit.id,
    scope: limit.scope,
    unit: limit.unit,
    amountMicros: limit.amountMicros,
    extensions: limit.extensions,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: which reached level a stop is about. The ceiling
 * is above every limit, and a limit that counts more work is above one that
 * counts less: an agent's Connection limit, the agent limit, the Connection
 * limit for all agents, then the own limit. The highest reached level stops
 * the work whatever happens below it, so the owner hears about that one first;
 * a lower one becomes the stop once the owner lifts the higher. `near` holds
 * the other levels at their warning share or past it.
 */
export function stopOf(
  ceiling: CeilingReading | null,
  limits: readonly LimitReading[],
): SpendStop | null {
  const nearOf = (readings: readonly LimitReading[]): NearLevel[] =>
    readings
      .filter((reading) => reading.state !== "ok")
      .map((reading) => ({
        level: levelOfLimit(reading),
        spentMicros: reading.spentMicros,
        effectiveMicros: reading.effectiveMicros,
      }));
  if (ceiling?.state === "reached")
    return {
      level: { kind: "ceiling", amountMicros: ceiling.ceiling.amountMicros },
      near: nearOf(limits),
    };
  const [highest] = limits
    .filter((reading) => reading.state === "reached")
    .sort(
      (a, b) => SCOPE_RANK[b.limit.scope.kind] - SCOPE_RANK[a.limit.scope.kind],
    );
  if (!highest) return null;
  return {
    level: levelOfLimit(highest),
    near: [
      ...nearOf(limits.filter((reading) => reading !== highest)),
      ...(ceiling?.state === "warn"
        ? [
            {
              level: {
                kind: "ceiling",
                amountMicros: ceiling.ceiling.amountMicros,
              } as const,
              spentMicros: ceiling.spentMicros,
              effectiveMicros: ceiling.ceiling.amountMicros,
            },
          ]
        : []),
    ],
  };
}
