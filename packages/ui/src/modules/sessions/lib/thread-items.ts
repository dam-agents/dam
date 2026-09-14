import { clockLabel, dayLabel, sameLocalDay, timeAgo } from "@/lib/format-time";

import type { Message } from "../../../types.js";

export type ThreadItem =
  | { kind: "message"; message: Message; index: number }
  | { kind: "divider"; variant: "day" | "run"; at: string; key: string };

interface Timed {
  at: string;
  role: Message["role"];
  index: number;
  date: Date;
}

function timedOf(messages: readonly Message[]): Timed[] {
  const timed: Timed[] = [];
  messages.forEach((message, index) => {
    if (message.at === undefined) return;
    const date = new Date(message.at);
    if (Number.isNaN(date.getTime())) return;
    timed.push({ at: message.at, role: message.role, index, date });
  });
  return timed;
}

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `day:${String(date.getFullYear())}-${month}-${day}`;
}

function dayDividers(timed: readonly Timed[]): Map<number, Timed> {
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

function dividerIndexFor(
  timed: readonly Timed[],
  startMs: number,
  end: number,
): number {
  let newest: Timed | undefined;
  for (const candidate of timed) {
    if (candidate.date.getTime() > startMs) continue;
    if (
      newest === undefined ||
      candidate.date.getTime() >= newest.date.getTime()
    )
      newest = candidate;
  }
  if (newest?.role === "user") return newest.index;
  return timed.find((t) => t.date.getTime() >= startMs)?.index ?? end;
}

function runDividers(
  timed: readonly Timed[],
  runStarts: readonly string[],
  end: number,
): Map<number, string[]> {
  const marks = new Map<number, string[]>();
  const starts = [...new Set(runStarts)]
    .map((at) => ({ at, ms: Date.parse(at) }))
    .filter((start) => Number.isFinite(start.ms))
    .sort((a, b) => a.ms - b.ms);
  for (const start of starts) {
    const index = dividerIndexFor(timed, start.ms, end);
    marks.set(index, [...(marks.get(index) ?? []), start.at]);
  }
  return marks;
}

export function threadItems(
  messages: readonly Message[],
  runStarts: readonly string[] = [],
): ThreadItem[] {
  const timed = timedOf(messages);
  const days = dayDividers(timed);
  const runs = runDividers(timed, runStarts, messages.length);
  const items: ThreadItem[] = [];

  const pushRuns = (index: number): void => {
    for (const at of runs.get(index) ?? []) {
      items.push({ kind: "divider", variant: "run", at, key: `run:${at}` });
    }
  };

  messages.forEach((message, index) => {
    pushRuns(index);
    const day = days.get(index);
    if (day !== undefined && !runs.has(index)) {
      items.push({
        kind: "divider",
        variant: "day",
        at: day.at,
        key: dayKey(day.date),
      });
    }
    items.push({ kind: "message", message, index });
  });
  pushRuns(messages.length);
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
