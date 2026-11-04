import type { SlackLoopGuardDrops } from "api-server-api";

import { clockLabel, formatDate, sameLocalDay } from "@/lib/format-time";

function dropTime(at: string, now: Date): string {
  return sameLocalDay(new Date(at), now)
    ? clockLabel(at)
    : `${formatDate(at, { month: "short", day: "numeric" })}, ${clockLabel(at)}`;
}

function minutes(ms: number): string {
  const count = Math.round(ms / 60_000);
  return count === 1 ? "a minute" : `${count} minutes`;
}

export function loopGuardNoticeCopy(
  drops: SlackLoopGuardDrops,
  now: Date = new Date(),
): { title: string; rule: string; latest: string | null } {
  const posts = drops.dropped === 1 ? "post" : "posts";
  return {
    title: `${drops.dropped} bot or app ${posts} dropped by the loop guard, last ${dropTime(drops.lastDroppedAt, now)}.`,
    rule:
      `When more than ${drops.limit} bot or app posts reach one conversation within ${minutes(drops.windowMs)}, ` +
      `bot and app posts there start no turn for ${minutes(drops.cooldownMs)}, ` +
      "and the conversation gets a notice saying so. A person's posts still start turns.",
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
