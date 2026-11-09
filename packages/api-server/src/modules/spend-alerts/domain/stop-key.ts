import { match } from "ts-pattern";

import type { SpendWorkStopped } from "../../../events.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: one key per level that stopped work: a limit at
 * its amount and its extension count for the day, or the owner's ceiling at
 * its amount. More stops at the same level share the key, so they tell the
 * owner once. Continue, a changed limit or a changed ceiling makes a new key,
 * so the next stop tells the owner again.
 */
export function stopKeyOf(event: SpendWorkStopped): string {
  const level = match(event.level)
    .with(
      { kind: "ceiling" },
      ({ amountMicros }) => `ceiling:${String(amountMicros)}`,
    )
    .with(
      { kind: "limit" },
      ({ limitId, amountMicros, extensions }) =>
        `limit:${limitId}:${String(amountMicros)}:${String(extensions)}`,
    )
    .exhaustive();
  return `spend-alerts:told:${event.ownerSub}:${event.day}:${level}`;
}

export function resetOf(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS);
}
