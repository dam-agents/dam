import { CronExpressionParser } from "cron-parser";
import rrulePkg from "rrule";
import { nextVisibleOccurrence, rruleProblem } from "api-server-api";
import type { QuietWindow, ScheduleSpec } from "api-server-api";

const { RRule } = rrulePkg;

export function validateCron(expr: string): void {
  CronExpressionParser.parse(expr);
}

export function validateRRule(
  expr: string,
  timezone: string,
  quietHours: QuietWindow[],
): void {
  const rule = RRule.fromString(expr);
  if (!rule) throw new Error(`invalid rrule: ${expr}`);
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
  try {
    const problem = rruleProblem(rrule);
    if (problem) return { kind: "stopped", reason: problem };
    const next = nextVisibleOccurrence(
      rrule,
      timezone,
      Temporal.Instant.fromEpochMilliseconds(from.getTime()),
      quietHours,
    );
    switch (next.kind) {
      case "next":
        return { kind: "next", at: new Date(next.at.epochMilliseconds) };
      case "exhausted":
        return { kind: "stopped", reason: "it has no more occurrences" };
      case "suppressed":
        return {
          kind: "stopped",
          reason: "quiet hours cover every remaining occurrence",
        };
    }
  } catch (e) {
    const message = errorMessage(e);
    return {
      kind: "stopped",
      reason: /^Maximum (iterations|candidate evaluations)/.test(message)
        ? "it never fires"
        : message,
    };
  }
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
