---
id: 095
title: RRULE occurrences come from a bounded search counted from a fixed start
status: accepted
subsystem: schedules
tags: [rrule, schedules]
summary: Schedule occurrences are computed with rrule-temporal, whose search is bounded, and every rule counts its steps from midnight on 1 January 2001 in the schedule's timezone; rules with COUNT, FREQ=SECONDLY or no future occurrence are rejected.
---

# ADR-095: RRULE occurrences come from a bounded search counted from a fixed start

**Date:** 2026-09-30
**Status:** Accepted
**Owner:** @jezekra1
**Amends:** ADR-031

## Context

On 2026-09-25 the production api-server went into a liveness-kill loop. An agent saved `FREQ=MINUTELY;INTERVAL=15;BYDAY=MO-FR;BYHOUR=7..18;BYMINUTE=0,15,30,45`, and computing its next occurrence never returned. Two faults combined. The platform used the evaluation instant as the rule's start, so steps counted from 11:47 never landed on the pinned minutes. And `rrule`, the library ADR-031 chose for the api-server and UI, steps sub-daily rules in loops that exit only on a matching value, so a step that never matches spins forever (upstream issue #468, open since 2021; no release since 2023). Every boot re-evaluated the rule and hung again.

## Decision

Schedule occurrences are computed with `rrule-temporal`, whose search is bounded, and every rule counts its steps from one fixed start: midnight on 1 January 2001 in the schedule's timezone. That date is a Monday and the first of a month, so a rule that leaves its time or day open defaults to midnight, Monday, and the 1st.

- A rule with no future occurrence is rejected at save time, in the schedule's own timezone and quiet hours. An enabled schedule left with no next run reports why — refused, never fires, ran out, or quiet hours cover it — derived when the schedule is read, so a repaired and re-armed schedule shows none.
- `COUNT` is rejected: counted from 2001, a count is spent before the schedule exists.
- `FREQ=SECONDLY` is rejected: schedules fire at minute granularity.
- `rrule` stays for building preset rules and rendering them as text. Neither computes occurrences.

## Amends

- **ADR-031** — its Libraries paragraph names `rrule` as the api-server and UI occurrence engine; occurrences now come from `rrule-temporal`, and `rrule` only builds and renders rules. The RRULE-plus-quiet-hours model it decided is unchanged.
- **ADR-031** — its Consequences list `count-based` rules among what users can express. `COUNT` is now refused, because with no stored start date a count has nothing to count from.

## Alternatives Considered

- **Guard `rrule` with our own scheduling math** — needed about 250 lines expanding pinned sub-daily rules into daily ones, and each review round found another input that still hung it.
- **Run `rrule` in a worker with a timeout** — makes occurrence computation async, and leaves the UI's synchronous form check able to freeze a tab.
- **`rrule-rust`** — returned no occurrences for the incident rule evaluated on a Saturday, and blocked for 5 s on `FREQ=HOURLY;BYSETPOS=3`.
- **Count from the evaluation instant, as before** — the cause of the incident; occurrences move with every restart and re-arm.

## Consequences

- **Easier:** every rule that hung the api-server or took seconds under `rrule` now answers within 100 ms. `rrule-temporal` matched a minute-by-minute RFC 5545 walk on 6,000 random pinned HOURLY/MINUTELY rules and on all 144 preset shapes tested.
- **Easier:** occurrences no longer depend on when they are computed. `FREQ=DAILY;INTERVAL=7;BYDAY=TU` used to fire or not depending on the evaluation day; it now never fires and is rejected at save.
- **Harder:** existing rules change phase. `FREQ=HOURLY` saved at 11:47 fired at xx:47 and now fires on the hour; a 02:30 daily rule skips the spring-forward night, as RFC 5545 requires, instead of firing at 03:30.
- **Harder:** stored rules with `COUNT` or `FREQ=SECONDLY` stop at their next re-arm and show the reason on the schedule.
- **Committed-to:** the fixed start. Changing it moves the occurrences of every rule whose interval does not divide its period.
- **Committed-to:** a runtime with `Temporal`. Node provides it; a browser without it skips the form's quiet-hours check, and the save call still runs it.
