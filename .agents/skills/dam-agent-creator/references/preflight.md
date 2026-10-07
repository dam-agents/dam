# The pre-flight pattern (scheduled runs)

Two reasons for the pattern: **cost** (a
10-minute heartbeat fires ~144×/day; runs that find nothing must cost ~zero) and
**auditability** (every decision that can be deterministic is made by a versioned script a
human can read, test and diff, not a model turn).

## The contract

One script, `scripts/preflight.sh <mode>`, one mode per scheduled run type. The task's
entry command runs it first; the agent follows its output.

**The script detects, it never acts:**

- Read-only toward every external system: list/GET only. No posts, field writes, message
  sends, or git commit/push.
- Local writes only for **bookkeeping**: design-mandated status flips (so transition logs
  stay one-shot), ledger counters for items with nothing due, its own log line, caches.
  Judgment and outward effects belong to the agent.
- Deterministic: same external state in → same worklist out. No model calls.
- Output: **exactly one JSON object on stdout** (all diagnostics to stderr or the log).

The agent-side contract, stated verbatim in the generated CLAUDE.md:

- `nothing_to_do: true` → echo `logs` as a one-line summary and **end the run**: no state
  writes, API calls or narration.
- Otherwise → perform **every** worklist entry per its `docs/` file, then persist state.
  The script decides *what*; the agent keeps its action-time re-checks for *whether it is
  still valid* (items move between detection and action).
- Script missing or non-JSON → log it and fall back to the manual `docs/` procedure: a
  broken script degrades to a slower run, never a skipped one.

## The Precheck — the same script, one step earlier

A platform schedule carries an optional **Precheck**: a shell command run *before* the
fire whose exit code decides whether a turn happens at all. The kit declares it per
schedule (`references/kit.md` → Schedules), pointing at `scripts/precheck.sh`, the adapter
from the pre-flight's JSON to that exit code. `preflight.sh` is unchanged; it gains a
second caller.

An idle occurrence then costs **no model at all**, where the agent-side `nothing_to_do`
short-circuit still wakes one to read the JSON: on a 10-minute heartbeat, ~144 wake-ups a
day versus only those that find work.

The runtime contract (`scripts/precheck.sh` implements it; the template states it
verbatim):

- **Exit 0** allows the run; **exit 1** declines this occurrence; **anything else** (a
  higher code, the two-minute deadline, a command that won't spawn) means the Precheck
  broke, and a broken Precheck **allows** the run and records the reason. Fail-open is
  deliberate: otherwise one typo exiting `127` silences a schedule for weeks while looking
  exactly like "nothing changed".
- **stdout is appended to the task prompt**, capped at 8 KiB, so the turn starts with the
  worklist in hand. Past the cap the adapter sends `logs` plus a re-run instruction rather
  than JSON cut mid-way.
- **stderr is not appended**, except that a broken Precheck's recorded reason carries its
  tail to the owner's panel, so secrets printed to stderr show there.
- Runs under `bash -lc`, cwd = the work directory, with `PLATFORM_SCHEDULE_ID`,
  `PLATFORM_FIRE_AT` and **`PLATFORM_LAST_RUN_AT`** set. The last is the last fire that
  *actually ran* (declines don't move it): the right "changed since?" watermark, better
  than a timestamp the agent keeps. It is an empty string until the first run; treat that
  as "everything is new", or the first fire misbehaves.

Two design consequences for the pre-flight:

- **Stay inside two minutes**, or every occurrence is a broken Precheck that runs anyway;
  the one-batched-listing-call rule below keeps that true.
- **A failed read still allows the run.** An `error` pre-flight hasn't answered "nothing
  changed", it failed to look. Declining would bury an outage in the decline counter,
  reading like a quiet week, so the adapter allows it and the turn reports it.

The platform's decline count is *since the last run*, not lifetime: how many occurrences
the check saved since work last happened, which tells the operator whether it still finds
anything.

## Designing the worklist

One JSON key per action kind, arrays of self-contained entries:

```json
{
  "mode": "work",
  "nothing_to_do": false,
  "read_set": ["docs/work.md"],
  "items_due": [
    {"id": 17, "rev": "abc123", "kind": "first", "title": "…", "takeover": false}
  ],
  "cleanups_due": [ {"id": 12, "reason": "gone"} ],
  "logs": ["item 17: new revision abc123 — due"]
}
```

- **Self-contained entries**: everything needed to act (ids, revisions, prior state,
  flags) is in the entry; the agent never re-derives what the script knew. Add a
  `takeover` flag when a stale lock was overridden, and take a lock over only when its
  holder is past the TTL **and** silent in the events log (a long job heartbeating its
  row is alive).
- **One array per action kind** (process / cleanup / self-heal / retry / notify…): each
  maps to a different `docs/` procedure and different safety re-checks.
- **`read_set`**: the docs this run reads, computed from the non-empty arrays: the core
  file of each due action kind, plus a rare-case file only when an entry needs it (a
  takeover, a re-check of earlier work, a closed item). The run reads exactly this list
  and reads a file needed later on its trigger. Every resident definition token is paid
  again on each call of the run, so a doc the run doesn't need is cost with no work behind
  it. A run without a worklist (fallback, audit, direct session) reads the docs map.
- **`logs`**: one-liners explaining every decision, skips included; the agent echoes them
  to the chat UI, and they are the audit trail of the script's reasoning.
- `error` + `nothing_to_do: true` for "could not even list" failures; the agent just logs
  those.
- **A failed read is never an answer.** A scan that couldn't run emits `null`/`unknown`
  plus a warn in `checks`/`logs`, never `0`, an empty array, or "no marker → not handled
  yet".

Emit with `jq -n` from arrays built during detection (see the template's `emit()` helper);
never hand-concatenate JSON strings.

## Cost discipline (enforced at design time)

- **One batched listing call** where the API allows; per-item calls only for items already
  known due.
- Per-item detail calls are fine in the weekly *audit* mode, not in a frequent heartbeat
  unless unavoidable (and then say so in the design).
- Cache what is re-fetched per run but rarely changes (e.g. installed helpers keyed by
  their source's content hash).
- Each scheduled run type states its cost: runs/day × non-idle ratio × agent work.

## Schedule task text

The task text is the single source of truth for the entry command, written once and
appearing in three places that must not drift: CLAUDE.md's run-types table, the
`schedules:` entry in `kit.yaml` (which creates it), and ONBOARDING's check-then-create for
kit-less deployments. Pattern:

> <Run name>. Run `bash "$HOME/scripts/preflight.sh" <mode>` first. If its JSON says
> nothing_to_do, report its logs in one line and end the run. Otherwise follow CLAUDE.md →
> "<Run section>": read exactly the worklist's read_set, …, and back up work/ at the end
> with `bash "$HOME/scripts/work-backup.sh" persist` when <state-repo env var> is set.

Changing an entry command later is a **major** bump (deployed schedules must be
re-registered; the changelog's upgrade block says so).

## Testing a generated pre-flight

1. `bash -n scripts/preflight.sh` — syntax.
2. Read-only dry run per mode against the real integration where reachable
   (`preflight.sh <mode> | jq .`): valid JSON, decisions match observable reality,
   `nothing_to_do` on a quiet target.
3. Pod compatibility: GNU-date-first with BSD fallback where the script may also run on
   macOS in development (`references/platform-dam.md`).
4. Source `scripts/lib/toolpath.sh` first when the script execs a shimmed CLI in a loop:
   on the pod `jq`/`gh` are `mise` shims costing ~250 ms per exec
   (`references/platform-dam.md` → Runtime environment).
5. Test the adapter's verdicts in `scripts/tests/` with a stubbed pre-flight on `PATH`:
   quiet → exit 1; worklist → exit 0 with the JSON on stdout; `error`, non-JSON and
   missing script → exit 0 each. Fail-open rules are the ones nobody notices breaking.
6. Time one real run per mode: past two minutes the Precheck breaks on every occurrence
   and the schedule silently loses its optimization.
