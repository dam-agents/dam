# The pre-flight pattern (scheduled runs)

Read when the design has at least one scheduled run type. The pattern exists for two
reasons: **cost** (a heartbeat fires ~144×/day at 10-minute cadence; runs that find
nothing must cost ~zero) and **auditability** (every decision that can be deterministic is
made by a versioned script a human can read, test, and diff — not by a model turn).

## The contract

One script, `scripts/preflight.sh`, with one mode argument per scheduled run type
(`preflight.sh <mode>`). The scheduled task's entry command runs it first; the agent then
follows its output.

**The script detects, it never acts:**

- Read-only toward every external system — list/GET calls only. No posts, no field
  writes, no message sends, no git commit/push.
- Local writes limited to **bookkeeping**: status flips mandated by the design (so
  transition logs stay one-shot), ledger counters for items with nothing due, its own log
  line, caches. Anything with judgment or outward effect belongs to the agent.
- Deterministic: same external state in → same worklist out. No model calls.
- Output: **exactly one JSON object on stdout** (all diagnostics to stderr or the log).

The agent-side contract, stated verbatim in the generated CLAUDE.md:

- `nothing_to_do: true` → echo the script's `logs` as a one-line summary and **end the
  run** — no state writes, no API calls, no narration.
- Otherwise → the agent performs **every** entry in the worklist per the referenced
  `docs/` file, then persists state. The script decides *what to do*; the agent keeps its
  own at-action-time re-checks for *whether it is still valid* (items move between
  detection and action).
- Script missing or emitting non-JSON → log it and fall back to the manual procedure in
  `docs/` — a broken script degrades to a slower run, never a skipped one.

## The Precheck — the same script, one step earlier

A platform schedule carries an optional **Precheck**: a shell command the runtime runs
*before* the fire, whose exit code decides whether a turn happens at all. The kit declares
it per schedule (`references/kit.md` → Schedules), pointing at `scripts/precheck.sh` — the
adapter that turns the pre-flight's JSON into that exit code. Nothing about
`preflight.sh` changes; it gains a second caller.

What it buys: an idle occurrence now costs **no model at all**, where the agent-side
`nothing_to_do` short-circuit still had to wake one to read the JSON. On a 10-minute
heartbeat that is the difference between ~144 wake-ups a day and however few of them find
work.

The runtime contract, which `scripts/precheck.sh` implements and the template states
verbatim:

- **Exit 0** allows the run; **exit 1** declines this occurrence; **anything else** — a
  higher code, the two-minute deadline, a command that will not spawn — means the Precheck
  broke, and a broken Precheck **allows** the run and records the reason. Fail-open is
  deliberate: the opposite default would let one typo exiting `127` silence a schedule for
  weeks while looking exactly like "nothing changed".
- **stdout is appended to the task prompt**, capped at 8 KiB, so the expensive turn starts
  with the worklist already in hand instead of re-deriving it. Past the cap the adapter
  sends the `logs` plus a re-run instruction rather than a worklist cut mid-JSON.
- **stderr is not appended** — except that a broken Precheck's recorded reason carries its
  tail, which reaches the owner's panel. So a check that prints secrets to stderr shows
  them there.
- The command runs under `bash -lc`, cwd is the work directory, with
  `PLATFORM_SCHEDULE_ID`, `PLATFORM_FIRE_AT` and **`PLATFORM_LAST_RUN_AT`** in the
  environment. That last one is the last fire that *actually ran* — declined occurrences
  do not move it — which makes it the correct "changed since?" watermark for a detection
  pass, and better than a timestamp the agent keeps itself.

Two design consequences for the pre-flight:

- **Stay inside two minutes**, or every occurrence is a broken Precheck that runs anyway.
  The one-batched-listing-call rule below is what keeps that true.
- **A failed read still allows the run.** A pre-flight that emits `error` has not answered
  "nothing changed" — it has failed to look. Declining would bury an outage in the decline
  counter, where it reads exactly like a quiet week, so the adapter allows it and lets the
  turn report it.

The decline count the platform shows is *since the last run*, not a lifetime total: it
says how many occurrences the check has saved since work last actually happened, which is
the number that tells the operator whether the check is still finding anything.

## Designing the worklist

One JSON key per action kind, arrays of self-contained entries:

```json
{
  "mode": "work",
  "nothing_to_do": false,
  "items_due": [
    {"id": 17, "rev": "abc123", "kind": "first", "title": "…", "takeover": false}
  ],
  "cleanups_due": [ {"id": 12, "reason": "gone"} ],
  "logs": ["item 17: new revision abc123 — due"]
}
```

- **Self-contained entries**: everything the agent needs to act (ids, revisions, prior
  state, flags) is in the entry — the agent should not have to re-derive what the script
  already knew. Include a `takeover` flag when a stale lock was overridden — and take a
  lock over only when its holder is both past the TTL **and** silent in the events log,
  since a long job that heartbeats its row is alive, not stale.
- **Separate arrays per action kind** (process / cleanup / self-heal / retry / notify…),
  because each maps to a different `docs/` procedure and different safety re-checks.
- **`logs`**: human-readable one-liners explaining every decision (including the skips) —
  the agent echoes them to the chat UI; they double as the audit trail of the script's
  reasoning.
- An `error` field + `nothing_to_do: true` for "could not even list" failures — the agent
  just logs those.
- **A failed read is never reported as an answer.** A scan that could not run emits
  `null`/`unknown` for that field plus a warn in `checks`/`logs` — never `0`, never an
  empty array, never "no marker found → not handled yet". A dedup scan that fails and
  reads as absence is a double-post; a count that fails and reads as zero is a report
  claiming a clean week it never measured.

Emit with `jq -n` from arrays built during detection (see the template's `emit()` helper);
never hand-concatenate JSON strings.

## Cost discipline (enforced at design time)

- **One batched listing call** where the API allows it — N-per-item calls only for items
  already known to be due.
- Per-item detail calls are acceptable in the *audit* mode (weekly) but not in a frequent
  heartbeat unless unavoidable; say so in the design if unavoidable.
- Cache anything re-fetched per run that rarely changes (installed helpers keyed by their
  source's content hash is the proven example).
- Every scheduled run type states its expected cost in the design: runs/day × non-idle
  ratio × agent work. The operator approves numbers, not vibes.

## Schedule task text

The scheduled task's text is the single source of truth for the entry command. It is
written once and appears in three places that must not drift: the run-types table in
CLAUDE.md, the `schedules:` entry in `kit.yaml` (which is what actually creates it), and
ONBOARDING's check-then-create for an agent deployed without a kit. Pattern:

> <Run name>. Run `bash "$HOME/scripts/preflight.sh" <mode>` first. If its JSON says
> nothing_to_do, report its logs in one line and end the run. Otherwise follow CLAUDE.md →
> "<Run section>": read docs/<file>.md, …, and commit & push work/ at the end when
> <state-repo env var> is set.

Changing an entry command later is a **major** version bump (deployed schedules must be
re-registered — the changelog's upgrade block says so).

## Testing a generated pre-flight

1. `bash -n scripts/preflight.sh` — syntax.
2. Read-only dry run per mode against the real integration where reachable
   (`preflight.sh <mode> | jq .`): valid JSON, decisions match observable reality,
   `nothing_to_do` on a quiet target.
3. Pod-compatibility sweep: GNU-date-first with BSD fallback where the script
   might also run on macOS during development (`references/platform-dam.md`).
4. Source `scripts/lib/toolpath.sh` first when the script execs a shimmed CLI in a loop —
   on the pod `jq`/`gh` are `mise` shims and each exec costs ~250 ms
   (`references/platform-dam.md` → Runtime environment).
5. Exercise the adapter's verdicts with a stubbed pre-flight on `PATH`: a quiet result
   must exit 1, a worklist exit 0 with the JSON on stdout, and an `error` result, a
   non-JSON result and a missing script must each exit 0. They belong in
   `scripts/tests/` — the fail-open rules are exactly the ones nobody notices breaking.
6. Time one real run per mode. Past two minutes the Precheck is broken on every
   occurrence and the schedule silently loses its optimization.
