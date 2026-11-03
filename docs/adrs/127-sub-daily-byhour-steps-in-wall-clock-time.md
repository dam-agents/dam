---
id: 127
title: A sub-daily RRULE with BYHOUR steps in wall-clock time from its first hour
status: accepted
subsystem: schedules
tags: [rrule, schedules]
summary: A FREQ=HOURLY or FREQ=MINUTELY rule with BYHOUR counts its steps in local wall-clock time from its first BYHOUR hour (and first BYMINUTE minute, for MINUTELY) on 1 January 2001, so it fires on the hours it lists all year; every other rule keeps ADR-095's start.
---

# ADR-127: A sub-daily RRULE with BYHOUR steps in wall-clock time from its first hour

**Date:** 2026-11-02
**Status:** Accepted
**Owner:** @jezekra1
**Amends:** ADR-095

## Context

ADR-095 counts every rule's steps from midnight on 1 January 2001 in the schedule's timezone, and `rrule-temporal` counts sub-daily steps in absolute time.
That midnight is in winter time, so in a timezone with daylight saving the steps of `FREQ=HOURLY;INTERVAL=2` land on even local hours in winter and on odd ones in summer.
A real schedule, `FREQ=HOURLY;INTERVAL=2;BYHOUR=9,11,13,15,17,19;BYMINUTE=37` in `Europe/Prague`, fired all summer; after the clocks went back on 25 October 2026 its next run moved to 28 March 2027.
RFC 5545 allows that result, but a user who lists the hours expects them all year, as `FREQ=DAILY` with the same `BYHOUR` gives.

## Decision

A `FREQ=HOURLY` or `FREQ=MINUTELY` rule with `BYHOUR` counts its steps in local wall-clock time, from its first (lowest) `BYHOUR` hour on 1 January 2001 — for `FREQ=MINUTELY`, at its first (lowest) `BYMINUTE` minute of that hour.
The occurrences are those of the rule in UTC from that start, read as local wall times in the schedule's timezone.

- `FREQ=HOURLY;INTERVAL=2;BYHOUR=9,11,13,15,17,19` fires at those hours in summer and winter; `FREQ=HOURLY;INTERVAL=2;BYHOUR=9`, which never fired from midnight, fires daily at 9:00.
- A wall time the clocks repeat fires once, at its first occurrence; a wall time spring-forward erases fires one hour later. That is what `FREQ=DAILY` does.
- A `UNTIL` in UTC is read as the wall time it is in the schedule's timezone, and a floating `UNTIL` as written.
- Every other rule, a sub-daily one without `BYHOUR` among them, keeps ADR-095's start and its absolute steps.

## Amends

- **ADR-095** — its Decision gives every rule one start, midnight on 1 January 2001; a sub-daily rule with `BYHOUR` now starts at its first `BYHOUR` hour that day, and steps in wall-clock time.
  Its Consequences commit to the fixed start; the start of other rules stays as it was.

## Alternatives Considered

- **Refuse `INTERVAL` above 1 together with `BYHOUR` on a sub-daily rule**, and suggest `FREQ=DAILY` with the hour list — stored rules like the incident one stop at their next re-arm, and their owners must rewrite them.
- **Step in wall-clock time from midnight** — the steps of `INTERVAL=2` land on even hours, so the incident rule would never fire in any season.
- **Step in wall-clock time for every sub-daily rule** — moves the occurrences of rules without `BYHOUR`, which do not meet the problem: they have no hours to land on.

## Consequences

- **Easier:** a sub-daily rule with an hour list fires on those hours all year, in every timezone.
- **Harder:** stored rules of this shape change phase, because their steps start somewhere else: `FREQ=MINUTELY;INTERVAL=90;BYHOUR=10,11` fired at 10:30 alone and now fires at 10:00 and 11:30.
- **Harder:** a stored rule of this shape can lose some of its pins. Its start is itself a pin, so it never loses all of them through the start alone: `FREQ=MINUTELY;INTERVAL=90;BYHOUR=1;BYMINUTE=30` fires daily at 1:30 as before, where steps counted from 1:00 would never reach a pin. A rule that does end up with no occurrence, through its other parts, stops at its next re-arm and shows "it never fires" on the schedule, as ADR-095 decided for any such rule.
- **Harder:** across a clock change the real time between two fires of such a rule grows or shrinks by the hour the clocks moved, as it does for `FREQ=DAILY`.
