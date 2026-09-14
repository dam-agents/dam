import { clockLabel, dayLabel, sameLocalDay, timeAgo } from "@/lib/format-time";

import type { Message } from "../../../types.js";

export type ThreadItem =
  | { kind: "message"; message: Message; index: number }
  | { kind: "divider"; variant: "day" | "run"; at: string; key: string };

interface Timed {
  message: Message;
  index: number;
  date: Date;
}

function timedOf(messages: readonly Message[]): Timed[] {
  const timed: Timed[] = [];
  messages.forEach((message, index) => {
    if (message.at === undefined) return;
    const date = new Date(message.at);
    if (Number.isNaN(date.getTime())) return;
    timed.push({ message, index, date });
  });
  return timed;
}

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `day:${String(date.getFullYear())}-${month}-${day}`;
}

function dayDividerIndices(timed: readonly Timed[]): Map<number, Timed> {
  const marks = new Map<number, Timed>();
  const first = timed[0];
  if (first === undefined) return marks;
  let spansDays = false;
  for (let i = 1; i < timed.length; i++) {
    const previous = timed[i - 1]!;
    const current = timed[i]!;
    if (sameLocalDay(previous.date, current.date)) continue;
    spansDays = true;
    marks.set(current.index, current);
  }
  if (spansDays) marks.set(first.index, first);
  return marks;
}

export function threadItems(messages: readonly Message[]): ThreadItem[] {
  const days = dayDividerIndices(timedOf(messages));
  const items: ThreadItem[] = [];
  messages.forEach((message, index) => {
    const day = days.get(index);
    if (day !== undefined) {
      items.push({
        kind: "divider",
        variant: "day",
        at: day.message.at!,
        key: dayKey(day.date),
      });
    }
    items.push({ kind: "message", message, index });
  });
  return items;
}

export function dividerLabel(
  item: Extract<ThreadItem, { kind: "divider" }>,
  now: Date,
): string {
  const day = dayLabel(item.at, now);
  return item.variant === "run"
    ? `${day} ${clockLabel(item.at)} · Scheduled run`
    : day;
}

export function timeProps(
  at: string | undefined,
  now: Date,
): { timeLabel?: string; timeTitle?: string } {
  if (at === undefined) return {};
  return {
    timeLabel: timeAgo(at, now),
    timeTitle: `${dayLabel(at, now)} ${clockLabel(at)}`,
  };
}
