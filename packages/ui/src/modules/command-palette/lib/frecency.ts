import { z } from "zod";

import { halfLifeDecay, RANKING } from "./ranking.js";

export const frecencySchema = z.record(
  z.string(),
  z.object({ s: z.number().nonnegative(), t: z.number() }),
);
export type Frecency = z.infer<typeof frecencySchema>;

export function usesAt(table: Frecency, id: string, now: number): number {
  const entry = table[id];
  return entry
    ? entry.s * halfLifeDecay(now - entry.t, RANKING.FRECENCY_HALF_LIFE_MS)
    : 0;
}

export function recordUse(table: Frecency, id: string, now: number): Frecency {
  const next = { ...table, [id]: { s: usesAt(table, id, now) + 1, t: now } };
  const ids = Object.keys(next);
  if (ids.length <= RANKING.MAX_FRECENCY_ENTRIES) return next;
  const kept = ids
    .sort((a, b) => usesAt(next, b, now) - usesAt(next, a, now))
    .slice(0, RANKING.MAX_FRECENCY_ENTRIES);
  return Object.fromEntries(kept.map((id) => [id, next[id]!]));
}
