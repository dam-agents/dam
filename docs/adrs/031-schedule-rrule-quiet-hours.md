# ADR-031: Schedules use RRULE for includes and structured quiet hours for exclusions

**Date:** 2026-04-23
**Status:** Accepted
**Owner:** @jezekra1

## Context

Today a schedule is a single standard cron string plus an `enabled` toggle (see [ADR-008](008-trigger-files.md)). This works for simple recurrences but breaks down for common calendaring needs:

- "Every 30 minutes on weekdays, except overnight."
- "Mondays and Wednesdays at 07:30, in my timezone."
- "Every hour, but pause during our team holiday week."

Cron has no timezone (the controller runs in UTC), no way to express an overnight window that crosses midnight, and no "skip this range" primitive. Users can disable the whole schedule with the manual toggle, but have to remember to flip it twice a day. Issue [#253](https://github.com/kagenti/platform/issues/253) captures the user need: a way to say "run like this, but not during these windows."

We considered two families of solutions:

1. **Keep cron for includes; add a structured "quiet hours" list for excludes.**
2. **Adopt RFC 5545 RRULE for includes; use RRULE's own `EXRULE`/`EXDATE` for excludes.**

On investigation, `EXRULE` is a poor fit for this use case specifically — not because of its RFC deprecation, but because `RRULE`/`EXRULE` perform set subtraction over discrete DATE-TIME instants, whereas quiet hours are naturally time-of-day *intervals*. To suppress "every 30 min during 22:00–06:00" via `EXRULE`, the exclusion rule has to emit a matching instant at every include candidate, e.g. `FREQ=MINUTELY;BYHOUR=22,23,0,1,2,3,4,5` — 480 instants per window per day, and it silently breaks if include cadence ever lands between them. An interval-containment check (`now ∈ window`) models the user's intent directly and needs no set math.

At the same time, cron's include side is too limited for things we do want to express (timezone, richer weekday patterns). RRULE handles all of that cleanly: `FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30` is a one-liner, and RFC 5545 bakes in timezone via `TZID`.

## Decision

A schedule is composed of:

1. **An include rule** expressed as an RFC 5545 RRULE (optionally an RRuleSet with `RDATE`/`EXDATE` for one-off adjustments). This defines "when to fire."
2. **An optional list of quiet-hours windows** — a first-class, structured field (not RRULE-based). Each window is just a time-of-day range (`startTime`, `endTime`) plus a per-window `enabled` flag, interpreted in the schedule's timezone and applied every day. A candidate fire inside **any** enabled window is suppressed. We intentionally do **not** support days-of-week or date ranges on windows in this iteration — see "Alternatives Considered."
3. **A timezone** (IANA, e.g. `Europe/Prague`) applied to both the RRULE and the quiet-hours windows.
4. **A schedule-level `enabled` flag** (unchanged from today) that disables the whole schedule when false.

```yaml
# ScheduleSpec (platform.ai/v1)
version: platform.ai/v1
type: rrule
timezone: Europe/Prague
rrule: "FREQ=MINUTELY;INTERVAL=30;BYDAY=MO,TU,WE,TH,FR"
quietHours:
  - startTime: "22:00"                   # daily, local time
    endTime:   "06:00"                   # < startTime → crosses midnight
    enabled:   true
  - startTime: "12:00"                   # lunch quiet hour, temporarily off
    endTime:   "13:00"
    enabled:   false
task: "Check monitoring dashboards"
enabled: true                            # schedule-level on/off
```

**Fire evaluation.** The controller computes the next RRULE occurrence after `now`, walking past any occurrences that fall inside an enabled quiet-hours window, and sleeps directly to the first surviving occurrence. Suppressed occurrences are never woken for — the goroutine simply skips over them when computing the next wake time. `status.yaml.nextRun` reflects the next occurrence that will actually fire; `status.yaml.lastResult` is `success` or an error message. Quiet hours are communicated to the user by the absence of fires in the suppressed window (the UI shows quiet-hours windows in the schedule editor and as a marker on the card), not by a per-skip status entry.

**Window semantics: `[startTime, endTime)`.** `startTime` is inside the quiet window (fire suppressed); `endTime` is outside (fire allowed). Concretely, a `22:00–06:00` window suppresses the 22:00 tick — agent work started at 22:00 would bleed into the quiet period — and fires at 06:00, since the reply lands shortly after and is safely outside the window. `endTime < startTime` is valid and means the window crosses midnight, evaluated as `[start, 24:00) ∪ [00:00, end)`.

**Suppressed runs are dropped, not deferred.** If the cron would have fired three times during a quiet window, zero runs happen — we don't queue them for when the window closes. This matches the intent in issue #253 ("run often but politely") and avoids thundering-herd bursts.

**Libraries.** [`github.com/teambition/rrule-go`](https://pkg.go.dev/github.com/teambition/rrule-go) on the controller side, [`rrule`](https://www.npmjs.com/package/rrule) on the API-server / UI side. Both are mature ports of python-dateutil with matching semantics. The controller's current dependency on `robfig/cron/v3` is removed for `type: rrule` schedules; a per-schedule goroutine sleeps to the next computed occurrence, fires or skips, and recomputes.

**Backwards compatibility.** Existing `type: "cron"` schedules continue to work via the legacy `robfig/cron` path. The UI will create only `type: "rrule"` schedules going forward; a future ADR may convert existing cron schedules if we decide to unify.

## Alternatives Considered

**Keep cron for includes, add structured quiet hours.** Smallest migration — existing schedules don't change shape, we just add an `excludes` list. Rejected because cron still can't express "in my timezone" or richer weekly patterns without contortions, and we'd end up layering another include format on top later. If we're changing the shape, we should change it once.

**Adopt RRULE for includes, use EXRULE/EXDATE for excludes.** A single standard format is appealing. Rejected because `EXRULE` is set subtraction over instants (see Context). Supporting "22:00–06:00" requires emitting a matching exclusion instant for every possible include instant — fragile, verbose, and materializes large instance sets just to answer "is now in the window." `EXDATE` is fine for one-off skips but doesn't address recurring windows at all. Our structured `quietHours` is evaluated in a single interval check at fire time, independent of include cadence.

**Bespoke DSL for both sides.** A JSON object like `{ daysOfWeek, timeRanges, dateRanges }` for both includes and excludes. Rejected for the include side: it reinvents RRULE badly (no month-nth-weekday, no counts-until, no every-N-weeks). Kept for the exclude side, where the model is genuinely "list of intervals."

**Richer quiet-hours windows (days-of-week, date ranges).** An earlier draft of this ADR allowed windows to carry `daysOfWeek` and `startDate`/`endDate`. Rejected for this iteration: day-of-week and date-bounded exclusions can be expressed on the *include* side by narrowing the RRULE (e.g. `BYDAY=MO,TU,WE,TH,FR` already excludes weekends; `UNTIL=20260721T000000Z` already bounds a vacation). Keeping windows as pure time-of-day ranges makes the UI a trivial list of "from HH:MM to HH:MM" rows and sidesteps edge cases around timezone-aware date arithmetic. We can extend the window shape later if a real use case appears that can't be expressed on the RRULE side.

**Pre-compute all fire times for the next N days.** Have the controller materialize RRULE into a list of timestamps, run-length-filter by quiet hours, and store the result. Rejected: bigger state surface, awkward around daylight-saving transitions and schedule edits, and doesn't save meaningful work over "sleep to next, evaluate, fire or skip."

## Consequences

- Users get timezone-aware schedules and can express calendar-style rules (weekdays, nth-weekday-of-month, until-date, count-based) without leaving the UI.
- Quiet hours are a first-class concept in the UI, distinct from the recurrence rule — the editor naturally splits into "run when" and "except when" sections.
- The controller gains an RRULE evaluator goroutine-per-schedule. DST transitions fall out correctly because `rrule-go` evaluates in the schedule's `TZID`.
- Suppressed fires leave no direct trace in `status.yaml.lastResult` — the UI derives "there are quiet hours in effect" from the `quietHours` field on the schedule spec, and `nextRun` naturally shows the next post-window firing time.
- Two include formats (`cron` for legacy schedules, `rrule` for new) coexist in the controller until we decide to migrate. The controller dispatches on `type`.
- Library dependencies added: `teambition/rrule-go` (Go), `rrule` (npm). Both are widely used and maintained.
- Issue #253 is addressed fully by the `quietHours` field; the broader cron-expressiveness gap is addressed by adopting RRULE.
