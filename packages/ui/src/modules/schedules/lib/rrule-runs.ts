import { rruleNextFire } from "api-server-api";

export function nextRRuleRuns(
  rrule: string,
  timezone: string,
  from: Date,
  count: number,
): Date[] | null {
  if (!("Temporal" in globalThis)) return null;
  const runs: Date[] = [];
  let after = Temporal.Instant.fromEpochMilliseconds(from.getTime());
  while (runs.length < count) {
    const next = rruleNextFire(rrule, timezone, after, []);
    if (next.kind !== "next") break;
    runs.push(new Date(next.at.epochMilliseconds));
    after = next.at.toInstant();
  }
  return runs;
}
