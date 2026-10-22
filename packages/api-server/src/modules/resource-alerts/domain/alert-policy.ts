import {
  poolLevel,
  STORAGE_NEARLY_FULL_PERCENT,
} from "../../budgets/domain/vm-usage.js";

export type AlertKind = "storage" | "runner_oom";

export interface AlertMark {
  level: string;
  notifiedLevel: string | null;
  notifiedAt: Date | null;
}

export interface AlertStep {
  mark: AlertMark;
  send: boolean;
}

export const STORAGE_REARM_PERCENT = 80;
export const STORAGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const OOM_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type StorageLevel = "ok" | "high" | "full";
const RANK: Record<StorageLevel, number> = { ok: 0, high: 1, full: 2 };

export const CLEAR_MARK: AlertMark = {
  level: "ok",
  notifiedLevel: null,
  notifiedAt: null,
};

function storageLevel(level: string): StorageLevel {
  return level === "high" || level === "full" ? level : "ok";
}

function readingOf(percent: number): StorageLevel {
  if (percent >= STORAGE_NEARLY_FULL_PERCENT) return "full";
  if (poolLevel(percent) === "critical") return "high";
  return "ok";
}

// UNIT_BOUNDARY_DESCRIPTION: one storage reading moves an owner's alert mark. A message goes out only when the reading rises past the level the owner was last told about, at most once a day, except that one escalation from high to full may go out inside the day because full means writes are failing. A reading under the re-arm threshold resets the level, and the band between it and high holds whatever level stands, so an owner hovering near 90% is not messaged at every poll. A suppressed rise leaves the level where it was, so the next reading past the day sends it.
export function nextStorage(
  prev: AlertMark,
  percent: number,
  now: Date,
): AlertStep {
  if (percent < STORAGE_REARM_PERCENT)
    return { mark: { ...prev, level: "ok" }, send: false };
  const reading = readingOf(percent);
  if (RANK[reading] <= RANK[storageLevel(prev.level)])
    return { mark: prev, send: false };
  const dayOver =
    prev.notifiedAt === null ||
    now.getTime() - prev.notifiedAt.getTime() >= STORAGE_INTERVAL_MS;
  const escalation = reading === "full" && prev.notifiedLevel !== "full";
  if (!dayOver && !escalation) return { mark: prev, send: false };
  return {
    mark: { level: reading, notifiedLevel: reading, notifiedAt: now },
    send: true,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: one look at how many of an owner's agents carry the runner out-of-memory reason moves their alert mark. An episode opens on the first affected agent and sends one message, unless one went out in the last six hours, so a runner that keeps getting killed sends one; it closes once no agent carries the reason, which re-arms the next one.
export function nextOom(
  prev: AlertMark,
  affected: number,
  now: Date,
): AlertStep {
  const open = prev.level === "open";
  if (affected === 0)
    return { mark: open ? { ...prev, level: "ok" } : prev, send: false };
  if (open) return { mark: prev, send: false };
  const send =
    prev.notifiedAt === null ||
    now.getTime() - prev.notifiedAt.getTime() >= OOM_INTERVAL_MS;
  return {
    mark: send
      ? { level: "open", notifiedLevel: "open", notifiedAt: now }
      : { ...prev, level: "open" },
    send,
  };
}
