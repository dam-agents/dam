import type { NotificationItem } from "./notification-types.js";

export type TimeSection = "Today" | "Yesterday" | "Earlier";

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

export function timeSection(at: string | null, now: number): TimeSection {
  if (!at) return "Earlier";
  const ts = Date.parse(at);
  const todayStart = startOfDay(new Date(now));
  if (ts >= todayStart) return "Today";
  const yesterdayStart = todayStart - 86_400_000;
  if (ts >= yesterdayStart) return "Yesterday";
  return "Earlier";
}

export interface SectionedItems {
  section: TimeSection;
  items: NotificationItem[];
}

export function groupByTimeSection(
  items: readonly NotificationItem[],
  now: number,
): SectionedItems[] {
  const groups = new Map<TimeSection, NotificationItem[]>();

  for (const item of items) {
    const section = timeSection(item.at, now);
    const group = groups.get(section);
    if (group) {
      group.push(item);
    } else {
      groups.set(section, [item]);
    }
  }

  const order: TimeSection[] = ["Today", "Yesterday", "Earlier"];
  return order
    .filter((s) => groups.has(s))
    .map((section) => ({ section, items: groups.get(section)! }));
}
