import {
  SPEND_TURNS_MAX_SPAN_DAYS,
  SPEND_TURNS_MAX_WINDOWS,
} from "./schemas.js";

const DAY_MS = 86_400_000;

interface TimedTurn {
  startedAt: string;
  endedAt: string;
}

export interface SpendTurnWindow<T extends TimedTurn> {
  turn: T;
  from: string;
  to: string;
}

function windowEnd(turn: TimedTurn, next: TimedTurn | undefined): string {
  const cap = next ? Date.parse(next.startedAt) - 1 : Infinity;
  if (Date.parse(turn.endedAt) <= cap) return turn.endedAt;
  return new Date(Math.max(cap, Date.parse(turn.startedAt))).toISOString();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the spend.turns windows for a session's turns,
 * newest first. One read carries at most SPEND_TURNS_MAX_WINDOWS windows within
 * SPEND_TURNS_MAX_SPAN_DAYS back from the newest turn's end, so older turns get
 * no window. A window ends before the next turn starts, so a call counts in one
 * turn only. The web UI and `dam telemetry` both read turn cost with these
 * windows.
 */
export function spendTurnWindows<T extends TimedTurn>(
  turns: readonly T[],
): SpendTurnWindow<T>[] {
  const newest = [...turns].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  const end = Math.max(...newest.map((t) => Date.parse(t.endedAt)));
  const readable = newest
    .filter(
      (t) => end - Date.parse(t.startedAt) < SPEND_TURNS_MAX_SPAN_DAYS * DAY_MS,
    )
    .slice(0, SPEND_TURNS_MAX_WINDOWS);
  return readable.map((turn, i) => ({
    turn,
    from: turn.startedAt,
    to: windowEnd(turn, readable[i - 1]),
  }));
}
