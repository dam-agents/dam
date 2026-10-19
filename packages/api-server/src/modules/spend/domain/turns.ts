import type { SpendTurns } from "api-server-api";
import type { SpendUnit } from "./units.js";
import { UNIT_RANK } from "./units.js";

export interface SettledCall {
  readonly callId: string;
  readonly callingAgentId: string;
  readonly ownerSub: string;
  readonly payer: string;
  readonly sessionId: string;
  readonly startedAt: Date;
  readonly unit: SpendUnit;
  readonly costMicros: number;
}

export interface TurnWindowRow {
  readonly window: number;
  readonly unit: SpendUnit;
  readonly costMicros: number;
  readonly calls: number;
}

export function foldTurns(
  windows: readonly { from: string; to: string }[],
  rows: readonly TurnWindowRow[],
): SpendTurns {
  return {
    windows: windows.map((w, index) => {
      const own = rows
        .filter((row) => row.window === index)
        .sort((a, b) => UNIT_RANK.indexOf(a.unit) - UNIT_RANK.indexOf(b.unit));
      return {
        from: w.from,
        to: w.to,
        amounts: own.map((row) => ({
          unit: row.unit,
          costMicros: row.costMicros,
        })),
        calls: own.reduce((sum, row) => sum + row.calls, 0),
      };
    }),
  };
}
