import type { SlackLoopGuardDrops } from "api-server-api";

import { clockLabel, formatDate, sameLocalDay } from "@/lib/format-time";

function dropTime(at: string, now: Date): string {
  return sameLocalDay(new Date(at), now)
    ? clockLabel(at)
    : `${formatDate(at, { month: "short", day: "numeric" })}, ${clockLabel(at)}`;
}

export function loopGuardNoticeCopy(
  drops: SlackLoopGuardDrops,
  now: Date = new Date(),
): { title: string; rule: string; latest: string | null } {
  const posts = drops.dropped === 1 ? "post" : "posts";
  return {
    title: `${drops.dropped} bot or app ${posts} dropped by the loop guard, last ${dropTime(drops.lastDroppedAt, now)}.`,
    rule:
      `Once ${drops.limit} bot or app posts in a row reach one conversation, ` +
      "later ones start no turn until a person posts there, a day passes " +
      "without one being let through, or the platform restarts.",
    latest:
      drops.recent.length === 0
        ? null
        : drops.recent
            .map(
              (drop) =>
                `${drop.name} (${drop.sender}, ${drop.thread ? "in a thread" : "top level"}, ${dropTime(drop.at, now)})`,
            )
            .join("; "),
  };
}
