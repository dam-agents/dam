import type { NotificationItem } from "./notification-types.js";

export type TimeSection =
  | "Today"
  | "Yesterday"
  | "Last 7 days"
  | "Last 30 days"
  | "Older";

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

export function timeSection(at: string | null, now: number): TimeSection {
  if (!at) return "Older";
  const ts = Date.parse(at);
  const todayStart = startOfDay(new Date(now));
  if (ts >= todayStart) return "Today";
  const yesterdayStart = todayStart - 86_400_000;
  if (ts >= yesterdayStart) return "Yesterday";
  const sevenDaysAgo = todayStart - 7 * 86_400_000;
  if (ts >= sevenDaysAgo) return "Last 7 days";
  const thirtyDaysAgo = todayStart - 30 * 86_400_000;
  if (ts >= thirtyDaysAgo) return "Last 30 days";
  return "Older";
}

export interface SectionedItems {
  section: TimeSection;
  items: NotificationItem[];
}

const ORDER: TimeSection[] = [
  "Today",
  "Yesterday",
  "Last 7 days",
  "Last 30 days",
  "Older",
];

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

  return ORDER.filter((s) => groups.has(s)).map((section) => ({
    section,
    items: groups.get(section)!,
  }));
}
