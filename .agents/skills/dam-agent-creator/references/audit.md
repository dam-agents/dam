# The weekly audit run

Every generated agent gets one: it runs unattended, and without a scheduled self-check, silent failures (a dead schedule, drifted state, a stuck pipeline, an expired token) stay invisible until someone notices work not happening.
For reactive and on-demand agents it is usually the **only** scheduled run.
The alerts that cannot wait a week (an outage, a silent heartbeat, a failing backup) belong to the **monitor** (`references/architecture.md` → Monitor); the audit triages the monitor's week.

Default: weekly (e.g. Friday morning), gated by a config key (`audit_report: enabled` default).
**Read-only toward external systems and repair-free**: it reports; routine findings heal on their pipeline's next run, everything else goes to the operator.
Its only local write beyond its log line is memory consolidation (when the agent has memory).

## Division of labor

- **Deterministic checks** → the pre-flight's `audit` mode (without a pre-flight, the agent runs them from a `docs/audit.md` checklist): connectivity, log scans, state consistency, disk, version drift.
- **Judgment checks** → the agent: anything needing MCP tools (schedule existence), sampling output against rules, interpreting trends.

A skipped check is an incomplete audit: one impossible this week is a `warn` with the reason, never silently dropped.
Likewise a measurement whose scan failed reports `not measured` with the reason, never zero: a fabricated clean number is worse than a missing one.

## Universal check catalogue

Include what applies; add domain checks from the design's effects list.

**Deterministic (script side):**

- Auth/connectivity to each integration (an unauthenticated GET; plus rate-limit headroom where the API reports it).
- **Token scopes and CLI deps**: assert the scopes scheduled runs need (stated only in README) and that required commands exist.
  A missing scope silently breaks posting and only the operator can fix it, so check weekly, not only at onboarding.
- Backup invariants (git-backed state): no `work/.git` under the agent's home; a `.git` appearing in `work/` is an early concurrency signal (`references/platform-dam.md`).
- **Structure verification**: re-run `scripts/verify-onboarding.sh` (offline), the script onboarding ends with: the cheapest catch for state files drifted out of shape or a `CONFIG.md` key the runtime can't see.
- **Toolchain shims**: report every CLI behind a `mise` shim (`toolpath_shimmed`): it passes the dependency check while every process not sourcing the workaround pays the exec tax.
  The report reads what `toolpath_init` saw *before* shadowing anything, so an active workaround doesn't silence it; the finding is the image defect and keeps warning until real bin dirs precede the shim dir on `PATH` (§5a: reported, never absorbed).
- **Cost reconciliation**: the week's estimated spend (tokens × the operator-maintained price table) beside the platform's attributed spend (`mcp__platform-outbound__get_metrics`, `days: 7`, `granularity: summary`).
  Outside 0.5×–2× → warn with both figures: it detects a stale price row, it does not reconcile the two (the populations differ at the edges).
  A price row matches its own version only (`claude-opus-5` does not price `claude-opus-5-5`; pick the longest matching row); tokens under an unpriced model are **excluded and the cell marked `≥`**, a floor, never a guess, and the audit names the model.
  The busiest model in the attributed split is what the runs actually ran on: warn when it differs from `run_model`.
- **Session models**: the week's `tokens` events against `run_model` (what ran, from the log) beside the registered schedules' `spec.model` (what is configured, judgment side).
- **Harness adapter parts by name** (`install.sh --check`): hooks, auto-mode rules, the tool deny list, the lean subagent type; a partially-installed instance warns per part.
- **Memory budget** (only with memory): lines and line length of every distilled memory file against its bound (`references/architecture.md` → Memory); never the archive.
- **Disk space and inodes of every filesystem a run writes to** (the machine's disk, clones, the backup's tmpfs), not only `work/`.
- **The monitor's week** (`references/architecture.md` → Monitor): classifier blocks by day, tool and reason with the top patterns; API failures by class grouped into outages.
- **Per-item shape** (when items are measured): the medians of `secs`, `msgs`, `peak_ctx`, `repeats`, `failures`, `max_out` this week against the week before, the items the week's anomaly alerts named, and the baseline count per model.
- Run cadence: gaps in each run type's log vs. its schedule (missed runs).
- **Precheck health** per scheduled mode: run `scripts/precheck.sh <mode>` timed; assert exit 0 or 1, well inside the two-minute deadline.
  A broken or timed-out Precheck **fails open**: every occurrence pays for the full turn with no alarm, and the only symptom is a decline counter stuck at zero.
  Silent and expensive, so weekly.
- Error scan: `ERROR:`-prefixed lines across the week's logs; with the events log, also group **every `level: error` event into `failures[]` signatures** (`event`/`tool`/`error` with volatile bits normalized, dated first/last) for the diagnosis below, and apply the log retention sweep.
- Open issues on the definition repo (PRs filtered out): the agent's tracking issues wait on the operator; a weekly count keeps them remembered.
- **Counting rules**: a run's usage is its *last* `tokens` event (cumulative per session); a count pruning would delete comes from the facts file written before the prune; the error scan strips zero-count phrases first (`references/architecture.md` → Logging).
- State consistency: tracking rows vs external markers, sampled both ways (rows without markers, markers without rows).
- Stale locks, duplicate tracking rows, prune backlog, orphaned per-item files, orphaned published artifacts, leftover temp directories.
- Disk usage of the machine's disk; cache freshness.
- Definition cleanliness (`git -C "$HOME" status --porcelain` empty) and version currency (checked-out vs latest vs adopted `work/VERSION`; drift is a warn; the audit only reports, acting on versions happens in the direct session).

**Judgment (agent side):**

- Every designed schedule exists and is enabled (`mcp__platform-outbound__list_schedules`) with the cron ONBOARDING registered: a dead schedule is invisible to every other check (the log-gap check catches the past, this the future).
  Each must also be **firing**: `status.lastRun` within 1.5× its own cron's interval measured from that cron's last opportunity (a window-limited cron read on a Friday morning is judged against Thursday evening, not wall clock) and `lastResult` a success.
  Compare each against `kit.yaml` and the design: task text, `precheck` (missing on a gated run → it wakes the model on idle ticks; present on the audit → it is ungated by design), `model` = `run_model` (none under `default`) and `sessionTitle`; later kit edits never reach a live agent, so drift here is found only by this check.
  Report it; changing a schedule is the operator's call in the direct session.
  Judge only the designed schedules: an operator's own one is `info`.
  Dispatched one-time sessions due this week whose state is `missed` or `failed` → warn naming the item.
- **Failure diagnosis** for every `failures[]` signature: cause + fix, classified *environment* / *agent mistake* / *definition bug*; counting is not enough, nothing else asks *why*.
  A verified environment cause goes to `work/LESSONS.md`; a definition bug gets an **anonymous, deduplicated tracking issue on the definition repo**, filed only through the scanning script and only under `definition_issues: enabled` (`references/architecture.md` → Writes to the definition repo), the audit's only external write; the report carries the finding with its evidence in full and the issue link, or `issue withheld` with the reason.
- **Classifier blocks and model availability**: per top refusal pattern, a documented step of the agent (a script or subagent a procedure names) is a missing `autoMode.allow` rule → a definition bug with the proposed rule text; anything else is a refusal that stands, one line.
  A pattern whose rule shipped but whose adapter check names `automode-rules` is an install not re-run.
  Per outage: start, length, runs lost, the classes; two or more a week, or an authentication class, is **Action needed** (operator-only).
- Harness adapters (when designed): verify **each expected hook by name**; a partially-registered instance must warn.
- Sample this week's outputs (~3): required markers present, formats honored, memory rules/overrides respected, gates (labels, opt-ins) actually gated.
- Channel-facing agents, per the chosen record ordering (`references/architecture.md` → Record ordering): **send-then-record** → the same item messaged twice inside its cooldown (the send/record crash window) and send-failure signatures recurring across sweeps; **write-before-send** → claimed-but-unsent rows (state claims a send the log shows failing).
  Plus effectiveness ratios and items stuck at the escalation ceiling.
- Feedback on own output where the surface shows it (reactions, replies): read what a negative signal points at, route a real correction into memory per its rules, report one line per recorded lesson.
  A negative signal with no readable reason is reported as-is, never guessed at.
- Trends: throughput vs last week, outcome extremes (100% one verdict = suspicious), backlog age, idle-run ratio (falling ratio = rising bill; the gate's measure, never spend's, which task "cost reconciliation" owns).
- **Outcome shifts against the recorded baseline** (Trend history below): a share that moved 20 pp or more against the four recorded weeks, or a rate that halved or doubled, which a z-test (\|z\| ≥ 2) does not explain as noise → warn naming the **definition versions on both sides** (every output row records the `def` that wrote it) and, after reading two or three outputs of the moved side, whether the agent changed or the inputs did.
- **A human overruled the agent's verdict** (a change request after the agent's approve, a reverted item it passed): each is a defect the agent let through; read it, name the missed class, record the lesson, list the items under *Action needed*.
- Config validity: required keys present and parseable; roster integrity when one exists.

## Trend history

The audit measures; a history **keeps** the numbers, or every week is judged against memory.
Under `work/audit/`: `last-worklist.json` (overwritten), `weeks/<ts>.json` (one measured week, **append-only**, written once and never edited), and derived views (`TRENDS.md`, `report.html`) regenerated from the week files on every append, so a new column or a corrected price table reaches every past week.
Rules:

- A derived row keeps the **counts behind each share**, so a baseline pools counts and never averages shares; the audit reads its baselines from here instead of recounting.
- Zero is written only where zero was measured; a metric the week did not measure, or that did not exist yet, renders `—`, never a back-filled number.
- Raw per-session records (`{day, job, min, model, tokens…}`) stay raw and are priced at render time, so the whole history reprices when the table changes and a cost delta reflects usage, not a price move; the platform's attributed spend sits beside the estimate for the weeks telemetry retains.
- Publishing the report is optional (`audit_trend: dam | off`), updated in place so the URL is stable; the append is the history's only write and never touches other state.

## Report format

One message, traffic-light, counts and one-liners over prose:

```
🩺 *<display name> weekly audit* — <date> · 🟢 N ok · 🟡 N warn · 🔴 N fail

*Week in numbers* (since <ISO>)
• <domain throughput counters> · <backlog> · <idle ratio>
• Memory: merged X · promoted Y · dropped Z        (only with memory)

• Spend: $<actual> actual (est $<estimate>) · per item $<n> · model <busiest id> — or "actual not measured on this deployment"
• Trend: <week-over-week delta line> — <report url or "local only">
• Learned this week: <one compressed line per recorded lesson, or "nothing new">   (only with memory)

*Checks*
🔴 <id> — <detail>          ← every fail, never summarized away
🟡 <id> — <detail>
🟢 all other checks passed (<count>)

*Action needed*: <one line per item needing a human, or "none">
```

Always sent, green or not: an all-green report is the standing signal that the agent is alive and auditing itself, so its absence is itself the alert.

Delivery: the configured channel when notifications are enabled (a send failure is itself a finding → full report to the chat UI); the chat UI always.
Then append `<ISO> ok=<n> warn=<n> red=<n> sent=<channel|chat>` to `work/AUDIT.log` (avoiding the error scan's substrings) and persist `work/`.

## Optional: a periodic quality benchmark

For agents whose output quality is a judgment call (reviews, classifications, summaries): a rarer run (monthly, off by default, own config key) replays fixed synthetic fixtures through the full pipeline and scores output against seeded ground truth, recording time and token cost per item, so "did the model upgrade help?"
gets an answer.
Trust invariants: ground truth lives **outside** the pipeline's inputs (a set naming its own answers is never scored); fixture creation and scored runs never share a session; one scored run at a time behind a lock; results append-only and validated before entering the history; nothing in the production domain touched beyond its own report.
Difficulty: grade it in the ground truth on two axes, so the report can say "good enough for simple work, not for complex".
The task tier (`simple` \| `complex`: size, files, interacting changes) belongs to each fixture, with a minimum count per tier in the set; item difficulty (`easy` \| `hard`, hard = needs reasoning across items or steps, never a surface pattern) belongs to each seeded item.
Score each tier by pooling its fixtures into one sample (summed hits, false alarms and totals, never an average of small fractions), report easy and hard recall beside each other, and give each tier one verdict against an operator-set bar (own config table, documented defaults): sufficient, borderline, insufficient, or too few items to decide.
The bar has two measures per tier, recall over the seeded items and a false-alarm measure (precision, or wrong outputs on clean items), each with its own threshold; a tier is sufficient only when both clear.
Show the counts behind every verdict (`17/20`), and keep the verdicts beside the headline index, never inside it, so earlier runs stay comparable.
Propose it only where the operator would act on the numbers: it costs real tokens, and the complex tier costs the most.

## Memory consolidation (only when the agent has memory)

The audit's one write beyond its log: merge duplicate learned entries, promote the repeatedly confirmed into rules, compress or drop the stale, move an over-bound file's body to the archive and keep only its rules, never touch operator-tagged entries.
Report the delta in one line.
