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

The scheduled task's text (registered in ONBOARDING) is the single source of truth for
the entry command. Pattern:

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
3. Pod-compatibility sweep: no `awk`, GNU-date-first with BSD fallback where the script
   might also run on macOS during development (`references/platform-dam.md`).
4. Source `scripts/lib/toolpath.sh` first when the script execs a shimmed CLI in a loop —
   on the pod `jq`/`gh` are `mise` shims and each exec costs ~250 ms
   (`references/platform-dam.md` → Runtime environment).
