import type { FeedItem } from "./feed-item.js";

export type FeedEntry =
  | { type: "item"; item: FeedItem }
  | {
      type: "schedule-group";
      scheduleId: string;
      items: FeedItem[];
      latest: FeedItem;
    };

export function groupScheduleRuns(items: readonly FeedItem[]): FeedEntry[] {
  const scheduleMap = new Map<string, FeedItem[]>();
  const nonSchedule: FeedItem[] = [];

  for (const item of items) {
    const schedId = item.session.scheduleId;
    if (schedId) {
      let arr = scheduleMap.get(schedId);
      if (!arr) {
        arr = [];
        scheduleMap.set(schedId, arr);
      }
      arr.push(item);
    } else {
      nonSchedule.push(item);
    }
  }

  const entries: FeedEntry[] = [];

  const allOrdered = [...items];
  const placed = new Set<string>();

  for (const item of allOrdered) {
    if (placed.has(item.id)) continue;

    const schedId = item.session.scheduleId;
    if (schedId && scheduleMap.has(schedId)) {
      const group = scheduleMap.get(schedId)!;
      if (group.length >= 2) {
        if (!placed.has(schedId)) {
          placed.add(schedId);
          for (const g of group) placed.add(g.id);
          entries.push({
            type: "schedule-group",
            scheduleId: schedId,
            items: group,
            latest: group[0]!,
          });
        }
        continue;
      }
    }

    placed.add(item.id);
    entries.push({ type: "item", item });
  }

  return entries;
}
