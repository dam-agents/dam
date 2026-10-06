# The weekly audit run

Every generated agent gets one: it runs unattended, and without a scheduled self-check,
silent failures (a dead schedule, drifted state, a stuck pipeline, an expired token) stay
invisible until someone notices work not happening. For reactive and on-demand agents it
is usually the **only** scheduled run.

Default: weekly (e.g. Friday morning), gated by a config key (`audit_report: enabled`
default). **Read-only toward external systems and repair-free**: it reports; routine
findings heal on their pipeline's next run, everything else goes to the operator. Its only
local write beyond its log line is memory consolidation (when the agent has memory).

## Division of labor

- **Deterministic checks** → the pre-flight's `audit` mode (without a pre-flight, the
  agent runs them from a `docs/audit.md` checklist): connectivity, log scans, state
  consistency, disk, version drift.
- **Judgment checks** → the agent: anything needing MCP tools (schedule existence),
  sampling output against rules, interpreting trends.

A skipped check is an incomplete audit: one impossible this week is a `warn` with the
reason, never silently dropped. Likewise a measurement whose scan failed reports `not
measured` with the reason, never zero: a fabricated clean number is worse than a missing
one.

## Universal check catalogue

Include what applies; add domain checks from the design's effects list.

**Deterministic (script side):**

- Auth/connectivity to each integration (an unauthenticated GET; plus rate-limit headroom
  where the API reports it).
- **Token scopes and CLI deps**: assert the scopes scheduled runs need (stated only in
  README) and that required commands exist. A missing scope silently breaks posting and
  only the operator can fix it, so check weekly, not only at onboarding.
- Backup invariants (git-backed state): no `work/.git` on the volume; `.nfs*` junk count
  under `work/` as an early concurrency signal (`references/platform-dam.md`).
- **Structure verification**: re-run `scripts/verify-onboarding.sh` (offline), the script
  onboarding ends with: the cheapest catch for state files drifted out of shape or a
  `CONFIG.md` key the runtime can't see.
- **Toolchain shims**: report every CLI behind a `mise` shim (`toolpath_shimmed`): it
  passes the dependency check while every process not sourcing the workaround pays the
  exec tax. The report reads what `toolpath_init` saw *before* shadowing anything, so an
  active workaround doesn't silence it; the finding is the image defect and keeps warning
  until real bin dirs precede the shim dir on `PATH` (§5a: reported, never absorbed).
- **Cost reconciliation**: the week's estimated spend (tokens × price list) beside the
  platform's real spend. A gap means the price list or the token count is wrong, and every
  cost decision made on the estimate inherits it.
- **Memory budget** (only with memory): lines and line length of every distilled memory
  file against its bound (`references/architecture.md` → Memory); never the archive.
- Run cadence: gaps in each run type's log vs. its schedule (missed runs).
- **Precheck health** per scheduled mode: run `scripts/precheck.sh <mode>` timed; assert
  exit 0 or 1, well inside the two-minute deadline. A broken or timed-out Precheck **fails
  open**: every occurrence pays for the full turn with no alarm, and the only symptom is a
  decline counter stuck at zero. Silent and expensive, so weekly.
- Error scan: `ERROR:`-prefixed lines across the week's logs; with the events log, also
  group **every `level: error` event into `failures[]` signatures** (`event`/`tool`/`error`
  with volatile bits normalized, dated first/last) for the diagnosis below, and apply the
  log retention sweep.
- Open issues on the definition repo (PRs filtered out): the agent's tracking issues wait
  on the operator; a weekly count keeps them remembered.
- State consistency: tracking rows vs external markers, sampled both ways (rows without
  markers, markers without rows).
- Stale locks, duplicate tracking rows, prune backlog, orphaned per-item files, orphaned
  published artifacts, leftover temp directories.
- Disk usage of the volume; cache freshness.
- Definition cleanliness (`git -C "$HOME" status --porcelain` empty) and version currency
  (checked-out vs latest vs adopted `work/VERSION`; drift is a warn; the audit only
  reports, acting on versions happens in the direct session).

**Judgment (agent side):**

- Every designed schedule exists and is enabled (`mcp__platform-outbound__list_schedules`)
  with the cron ONBOARDING registered: a dead schedule is invisible to every other check
  (the log-gap check catches the past, this the future). Compare each against `kit.yaml`:
  later kit edits never reach a live agent, so a task text or `precheck` that moved on in
  git is drift only this check finds. Report it; changing a schedule is the operator's
  call in the direct session.
- **Failure diagnosis** for every `failures[]` signature: cause + fix, classified
  *environment* / *agent mistake* / *definition bug*; counting is not enough, nothing
  else asks *why*. A verified environment cause goes to `work/LESSONS.md`; a definition
  bug gets a **deduplicated tracking issue on the definition repo** (search open issues
  first), the audit's only external write.
- Harness adapters (when designed): verify **each expected hook by name**; a
  partially-registered instance must warn.
- Sample this week's outputs (~3): required markers present, formats honored, memory
  rules/overrides respected, gates (labels, opt-ins) actually gated.
- Channel-facing agents, per the chosen record ordering (`references/architecture.md` →
  Record ordering): **send-then-record** → the same item messaged twice inside its
  cooldown (the send/record crash window) and send-failure signatures recurring across
  sweeps; **write-before-send** → claimed-but-unsent rows (state claims a send the log
  shows failing). Plus effectiveness ratios and items stuck at the escalation ceiling.
- Feedback on own output where the surface shows it (reactions, replies): read what a
  negative signal points at, route a real correction into memory per its rules, report
  one line per recorded lesson. A negative signal with no readable reason is reported
  as-is, never guessed at.
- Trends: throughput vs last week, outcome extremes (100% one verdict = suspicious),
  backlog age, idle-run ratio (falling ratio = rising bill).
- Config validity: required keys present and parseable; roster integrity when one exists.

## Report format

One message, traffic-light, counts and one-liners over prose:

```
🩺 *<display name> weekly audit* — <date> · 🟢 N ok · 🟡 N warn · 🔴 N fail

*Week in numbers* (since <ISO>)
• <domain throughput counters> · <backlog> · <idle ratio>
• Memory: merged X · promoted Y · dropped Z        (only with memory)

*Checks*
🔴 <id> — <detail>          ← every fail, never summarized away
🟡 <id> — <detail>
🟢 all other checks passed (<count>)

*Action needed*: <one line per item needing a human, or "none">
```

Delivery: the configured channel when notifications are enabled (a send failure is itself
a finding → full report to the chat UI); the chat UI always. Then append
`<ISO> ok=<n> warn=<n> red=<n> sent=<channel|chat>` to `work/AUDIT.log` (avoiding the
error scan's substrings) and persist `work/`.

## Optional: a periodic quality benchmark

For agents whose output quality is a judgment call (reviews, classifications, summaries):
a rarer run (monthly, off by default, own config key) replays fixed synthetic fixtures
through the full pipeline and scores output against seeded ground truth, recording time
and token cost per item, so "did the model upgrade help?" gets an answer. Trust
invariants: ground truth lives **outside** the pipeline's inputs (a set naming its own
answers is never scored); fixture creation and scored runs never share a session; one
scored run at a time behind a lock; results append-only and validated before entering the
history; nothing in the production domain touched beyond its own report. Propose it only
where the operator would act on the numbers: it costs real tokens.

## Memory consolidation (only when the agent has memory)

The audit's one write beyond its log: merge duplicate learned entries, promote the
repeatedly confirmed into rules, compress or drop the stale, move an over-bound file's
body to the archive and keep only its rules, never touch operator-tagged entries. Report the delta in one line. This keeps memory useful and
bounded.
