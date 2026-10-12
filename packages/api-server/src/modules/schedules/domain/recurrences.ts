import { CronExpressionParser } from "cron-parser";
import { rruleNextFire } from "api-server-api";
import type { QuietWindow, ScheduleSpec } from "api-server-api";

export function validateCron(expr: string): void {
  CronExpressionParser.parse(expr);
}

export function validateRRule(
  expr: string,
  timezone: string,
  quietHours: QuietWindow[],
): void {
  const next = nextRRuleFire(expr, timezone, quietHours, new Date());
  if (next.kind === "stopped")
    throw new Error(`rrule is rejected, ${next.reason}: ${expr}`);
}

export function validateTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(`invalid timezone: ${tz}`);
  }
}

export type NextFire =
  { kind: "next"; at: Date } | { kind: "stopped"; reason: string };

export function nextFire(spec: ScheduleSpec, from: Date): NextFire {
  if (spec.type === "once") {
    const at = new Date(spec.at);
    return at > from
      ? { kind: "next", at }
      : { kind: "stopped", reason: "its moment has passed" };
  }
  if (spec.type === "rrule")
    return nextRRuleFire(
      spec.rrule,
      spec.timezone,
      spec.quietHours ?? [],
      from,
    );
  try {
    const cron = CronExpressionParser.parse(spec.cron, {
      currentDate: from,
      tz: "UTC",
    });
    return { kind: "next", at: cron.next().toDate() };
  } catch (e) {
    return { kind: "stopped", reason: errorMessage(e) };
  }
}

export function nextFireAt(spec: ScheduleSpec, from: Date): Date | null {
  const next = nextFire(spec, from);
  return next.kind === "next" ? next.at : null;
}

function nextRRuleFire(
  rrule: string,
  timezone: string,
  quietHours: QuietWindow[],
  from: Date,
): NextFire {
  const next = rruleNextFire(
    rrule,
    timezone,
    Temporal.Instant.fromEpochMilliseconds(from.getTime()),
    quietHours,
  );
  return next.kind === "next"
    ? { kind: "next", at: new Date(next.at.epochMilliseconds) }
    : next;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function triggerExpiry(
  firedAt: Date,
  next: Date | null,
  ttlSec: number,
): Date {
  const byTtl = firedAt.getTime() + ttlSec * 1000;
  if (next === null || next.getTime() <= firedAt.getTime()) {
    return new Date(byTtl);
  }
  return new Date(Math.min(byTtl, next.getTime()));
}

export function localToInstant(local: string, tz: string): Date {
  let wall: Temporal.PlainDateTime;
  try {
    wall = Temporal.PlainDateTime.from(local);
  } catch {
    throw new Error(`invalid time: ${local}`);
  }
  return new Date(wall.toZonedDateTime(tz).epochMilliseconds);
}
