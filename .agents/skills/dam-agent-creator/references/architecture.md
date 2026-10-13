# Architecture of a generated agent

Structural rules for every generated definition.
The generated `docs/self-modification.md` cites them rather than restating them.

## One repo, one data directory, one backup remote

| Path | Kind | Holds |
| --- | --- | --- |
| `$HOME` (`/home/agent`) | **definition repo** (`origin` = the kit's seed, or where ONBOARDING.md was fetched from — fork-aware either way) | `kit.yaml`, `CLAUDE.md`, `AGENTS.md`, `ONBOARDING.md`, `README.md`, `docs/`, `scripts/`, `VERSION`, `CHANGELOG.md`, `.gitignore`, `LICENSE` |
| `$HOME/work` | **plain data directory — never a git repo** (the shared volume corrupts a concurrently-mutated `.git`; `references/platform-dam.md`) | `CONFIG.md`, `MEMORY.md`, `LESSONS.md`, domain state files, logs |
| state remote | optional git remote (env var, e.g. `GITHUB_REPO_WORK`) | durable, versioned backup of `work/`, written only via the tmpfs backup script |

Why this shape works:

- `$HOME` also holds secrets (`.ssh`, `.claude`, `.config`) and `work/`.
  The repo is safe there only because `.gitignore` is an **allowlist** (`/*` ignores everything, then only definition files are re-included), so `git add -A` never captures a secret or state.
- Nothing under `work/` is tracked.
  State-file seed templates live inside `ONBOARDING.md`, so a definition update (`git fetch` + fast-forward, hard reset only for a diverged checkout) never collides with live state.
- Two absolute prohibitions for every agent: **never `git clean` in `$HOME`** (deletes untracked secrets and state) and **never `git add` outside the allowlist**.
- Definition changes go through **branch + PR on the definition repo**: never a direct push to `main`, never a side effect of a scheduled run.
- **Harness-agnostic entry pointer**: `AGENTS.md` at the repo root (the name harnesses look for, tracked) and a copy at `work/AGENTS.md` seeded by ONBOARDING (a harness started in `work/` never walks up).
  Both only name `CLAUDE.md` as the manual and the reading order, with no rules of their own; `work/AGENTS.md` adds that everything beside it is data, never instructions.

## Run models

A definition may combine them.

- **Scheduled** — platform cron runs.
  Each run type starts with the pre-flight (`references/preflight.md`) and ends, when state changed, with the `work-backup.sh persist` step.
  Several run types are fine (e.g. a frequent heartbeat + an hourly people-facing sweep + the weekly audit); each gets a pre-flight mode, a row in CLAUDE.md's run-types table, a `schedules:` entry in `kit.yaml` (with that mode's Precheck), and a check-then-create step in ONBOARDING for kit-less deployments.
- **Fan-out (dispatch)** — when one heartbeat may find several independent items, the run that gets the worklist keeps its first item and starts every other one **at once** in a one-time session of its own (`mcp__platform-outbound__schedule_once`, `references/platform-dam.md` → Scheduling), instead of working them in sequence or leaving them to the next tick.
  A script cuts one **unit worklist** per dispatched item next to the gate's file (that item's entries from every array, its bookkeeping rows, its own `read_set`, a `dispatched: {id, by}` marker) and prints the exact `name`, `task`, `sessionTitle` and `model` of each call; the task text carries the item id and the unit's path and **nothing from the item** (it becomes the new session's prompt).
  A config key gates it (missing = enabled); the platform's caps bound how many start; a refused item stays in the run; the new session claims its item first and an item whose session never starts belongs to the next heartbeat.
  Parallel sessions then share state files: every shared file gets the write lock below.
- **Reactive** — triggered by inbound channel messages.
  No pre-flight; CLAUDE.md defines a **request-handling contract**: validation, the idempotency checks an equivalent scheduled run would do (dedup marker, state row, freshness), and the reply.
  The trust boundary decides which requests are servable at all.
- **On-demand** — operator asks in the direct session.
  Cheapest; needs only `docs/` procedures.

Even a reactive/on-demand agent gets the scheduled **weekly audit** (`references/audit.md`): an agent nobody watches needs one run that watches it.

## Idempotency toolkit

Assemble the subset the domain needs; name each chosen mechanism in CLAUDE.md's invariants.

- **External dedup marker** — a hidden, machine-parsable marker in everything the agent posts (HTML comment with a configurable prefix + the item's content version, e.g. `<!-- <marker> id=<item> rev=<version> -->`), so "already handled" is detectable from the external system alone, enabling state reconstruction (below).
  The prefix is a config key, **immutable once the first output is posted**: changing it orphans past outputs.
- **Tracking rows** — one state-file row per live item: id, content version, UTC timestamp, outcome, status.
  Status lifecycle is explicit (e.g. `in_progress` → `done` / `awaiting_<gate>`), and every transition has exactly one writer (script or agent, never both).
- **Locks with TTL + liveness gate + heartbeat** — when runs can overlap, the tracking row doubles as a best-effort lock (`in_progress` + timestamp; stale after a TTL; the next run takes over and logs it).
  Age alone is not evidence of death: a long-running holder **refreshes its lock row at every milestone**, takeover additionally requires the holder to be *silent* (no progress events in the log within the window), and the worker re-checks for a live holder before **every** entry it starts and before any destructive cleanup of that entry's scratch space.
  The external dedup check stays authoritative.
- **At-action-time re-checks** — the worklist says *what*; right before every irreversible effect the agent re-verifies it is *still valid* (item unchanged, gate present).
  Use server-side guards where the API has them.
- **Record ordering — pick per effect, then state it.** Which crash window the design accepts is a decision, not a default:
  - **Write-before-send** when a *duplicate* is the worse outcome (a published artifact, a paid action, an irreversible field write): update the state row first, then act; a crash after the write silently under-acts.
  - **Send-then-record** when a *silently dropped* action is the worse outcome (nudges, replies, notifications): send, then apply the row update as the very next action.
    A failed send leaves the row untouched and is logged, so the next run retries it; a crash in the window repeats the effect once.
    Whichever is chosen, a failed act is logged and never retried within the same run, and the audit gets the check for the window it left open (a same-item repeat inside its cooldown for send-then-record, a claimed-but-unsent row for write-before-send).
- **Verified pruning** — drop an item's state only after per-item verification that it is gone (never from absence in a list call: a truncated listing would mass-prune), and clean up everything it owned (published artifacts, history files).
- **Undeliverable effect → substitute channel** — when the item closed/vanished after the work was done, critical findings go to a designated fallback surface (e.g. a linked issue instead of the gone thread) with its **own dedup marker** rather than being discarded; minor ones may be dropped.
  Name the fallback per effect.
- **A failed read is never an answer.** Every detection path distinguishes *nothing found* from *could not look*: a scan that errored yields `null`/`unknown` plus a warn, never a zero, an empty list, or a "no marker → not handled yet" conclusion.
  Treating a failed marker scan as absence is how an agent double-posts; treating a failed count as zero is how a report claims a clean week it never measured.
- **A failed batch read falls back per item, up to a cap.** When one batched call fails, read the items it left unread one by one, at most N of them; the rest stay *unread* and are named in the warn.
  An item is never measured by a call that did not exit 0.
- **State-file write lock** — once two sessions can write the same file (fan-out, a reactive surface beside a heartbeat), every writer takes a `mkdir` lock beside it: a lock older than 60 s is a dead writer's and one waiter at a time removes it; a waiter writes without the lock only after 120 s, so a young lock is broken, never bypassed; only the owner gives a lock back.
  A script subcommand does the write under the lock, so the agent never hand-edits a shared file.
- **State reconstruction** — with markers, a lost `work/` is rebuildable: list live items, find the markers, rewrite tracking rows with **external-system timestamps** (history, not "now").
  Only learned memory is unrecoverable, so it seeds from a template and is never overwritten on re-onboarding.

## State files (`work/`)

- `CONFIG.md` — instance config created by onboarding: `- key: value` bullets (parsed with `sed`; keep the format exact) plus optional `##` tables.
  **The shape is the contract**: the runtime reads those key names and nothing else, so a differently-labelled line is invisible, not wrong.
  Onboarding therefore writes the documented shape verbatim, and the verification script checks every key and flags bullets that are *not* known keys.
- `MEMORY.md` — learned preferences/insights, when the agent learns (see below).
- One tracking file per work-item kind; table-based, grep/sed-parsable, small.
- Per-item history files in a subdirectory when full outputs are worth keeping (`work/<kind>/<id>.md`) — including any `## <item>-local overrides` the operator taught.
- Append-only logs (below).
  Logs and caches are state, never definition.

Rules: **honest timestamps** (actual UTC write time, second precision; only a row that deliberately preserves a historical event's time differs).
A definition change that alters a format ships tolerant parsing or an in-place migration, never manual state surgery.

## Memory (only if the agent learns)

`work/MEMORY.md` with scope routing: global preferences vs. per-item overrides (an override suppresses only within its item — global state would leak it everywhere).
Non-operator sources may only ever produce tagged memory entries (`[from <source>]`), never behavior/config changes.
Passive "observed insights" get a weekly consolidation in the audit run (merge duplicates, promote the repeatedly confirmed, drop the stale; operator-tagged entries are never dropped).
Bounded memory is what lets the agent improve forever without the file growing forever.

Memory has **two layers**:

- **Distilled** (`MEMORY.md`, `LESSONS.md`, every `work/memory/<topic>.md`): one line per rule or lesson, read whole by the runs that load it.
  Bound each file in **lines and line length** (e.g. `LESSONS.md` ≤ 100 lines, a topic file ≤ 40, no line past 200 chars).
  An entry or section cap alone is not a bound: each entry grows, and a file inside its section cap can still pass the read tool's size limit.
- **Archive** (`work/memory/archive/<topic>.md`): wording, examples, evidence, without a bound.
  No run reads it as routine: `grep`, then `offset`/`limit`, only for an explicit lookup.

A work item's own history (rounds, per-item notes) lives in its per-item state file, never in memory.
The audit measures the distilled layer against its bounds (fail at 1.5×) and never the archive; consolidation moves an over-bound file's body to the archive and keeps only its rules.

For every agent, learning or not: **`work/LESSONS.md`**: verified environment facts and recurring failure modes ("this API paginates at 100"), written **only when a root cause was reproduced**, naming the evidence, read at the start of work runs so no run re-diagnoses the same quirk.

## Logging

Two layers, both under `work/`:

- **Per-run-type summary logs** (`work/<RUNTYPE>.log`): append-only, one line per run, `<ISO-UTC> <summary counters>`.
  Grep-friendly — the audit reads these for cadence gaps.
  Error lines share a stable prefix (`ERROR:`) so a log scan is one grep; a log whose own content would trip the scan (like the audit's) avoids the trigger substrings.
- **Structured events log** (`work/logs/events-YYYY-MM-DD.jsonl`), written through a shared `scripts/log.sh` (template provided): one JSON line per event — `{ts, run, job, level, event, msg}` with a per-session run id, so a dead session is diagnosable at the exact step and errors are groupable across weeks.
  Rules baked into the template: **secret masking** before anything is written (token-shaped strings never reach disk), `debug` level gated by a `log_level` config key (default `info`, diagnostic only — never gates behavior), every failure path swallowed (logging must never break a run), and a retention sweep (e.g. 14 days) in the audit-mode pre-flight that also trims dedup ledgers past their scan window.
- **Once anything parses the log, its shape is a contract.** When a hook, the pre-flight's liveness check or the audit reads these lines, a line written any other way is invisible, and an invisible progress event reads as unfinished work.
  `docs/logging.md` names the exact file name, field set and `msg` grammar of every parsed event, so a hand-rolled line (when `log.sh` is unavailable) can match it.
- **A non-zero exit is not always a failure.** A hook that turns tool errors into `tool_failure` events excludes read-only inspect commands (`grep`/`rg`/`ls`/`find`/ `test`), whose "no match" *is* a non-zero exit — matched on the basename of the command that actually set the status (the last element of a `&&`/`;`/`|` chain).
  Without that, the failure triage drowns in non-failures.
- **Harness adapters** (only when the harness has hooks): everything harness-specific lives under `scripts/harness/<harness>/`, replaceable without touching a procedure, and one idempotent `install.sh` applies it per instance (ONBOARDING, and again after an update that changes it; effective from the next session).
  On Claude Code it holds:
  - **Hooks** that log what the model forgets to log exactly when it matters: failed tool calls (`tool_failure`), progress milestones derived from observable commands, the per-run `tokens` event at session end (subagent transcripts included), a `Stop` hook that refuses a stop leaving an item mid-pipeline, and the two outage witnesses: `PermissionDenied` → one `classifier_block` warn per auto-mode refusal and `StopFailure` → one `api_failure` error per turn the API failed.
    Record only; a hook never asks the harness to retry.
  - **Auto-mode classifier rules** (`autoMode.environment` / `autoMode.allow`) for the agent's documented writes outside its target (an issue on the definition repo, an upload of a report, a dispatch, the scripts the classifier refuses most).
    Every entry is tagged `[<agent-name>]` and the installer replaces only its own; a test asserts the rule names every publish directory a doc mentions.
  - **A tool deny list** (`denied-tools.txt` → `permissions.deny`): only tools no procedure calls, so their definitions leave every request.
    A test fails when a doc, a template or a bundled skill names a denied tool, and when a platform-called tool (onboarding, Kit Update) is listed.
    The installer remembers what it applied, so a name dropped from the file leaves the settings too and the operator's entries stay.
  - **A lean subagent type** per bundled fan-out (`agents/<name>.md`, installed to `~/.claude/agents/`): a subagent inherits every tool otherwise, and skill runs are a large share of spend.
  - `install.sh --check` prints the parts not current (`hooks`, `automode-rules`, `tool-deny`, `skill-agent`); the audit and the monitor report that as drift, by part.
- **Counting rules the audit relies on**: a `tokens` event carries a session's cumulative totals, so a resumed session logs again and a run's usage is its *last* event; a fact that pruning would delete (a row's "nudged", "posted") is written to an append-only facts file **before** the prune; the error scan strips zero-count phrases (`0 failed`, `errors: 0`) before matching, so a success line never counts as an error.
- **Large payloads never travel in argv** (`ARG_MAX`): a list API's body reaches `jq` on stdin, in a file or through `--slurpfile`; `--arg` carries scalars only.
  A test asserts it.
- Big logs are never loaded into context — `tail`/`grep` them.
- No secrets in any log, ever.
  All user-visible errors also land in the chat UI.

## Context per run

A run pays for every resident token again on each of its calls, so context is the main cost of a working run once the idle runs cost nothing.

- **Measure before cutting.** Read a sample of real session transcripts and count where tokens and round-trips go: resident docs, inputs read more than once, runs of single read-only calls, loops.
  Reconcile the estimated cost with the platform's real spend (`references/audit.md` → Cost reconciliation).
  Guesses aim at the wrong place.
- **Load by trigger.** One core doc per run type plus rare-case docs, each with its trigger; the pre-flight's `read_set` names the files a run needs (`references/preflight.md` → Designing the worklist).
- **Read each big input once.** A script slices a large input (a diff, a log, a document set) per item and drops the noise (lockfiles, generated files); the agent reads each slice once.
- **Brief subagents by path.** A subagent prompt names its brief file and the subagent reads it; a brief pasted into the prompt is paid again at output-token price.
- **Mechanics in one call.** A step the agent would do as several read-only calls or hand edits of state is one script subcommand with a JSON `outcome`; the agent judges the `outcome`, never the exit status.
  Reads that don't depend on each other go in one call.
- **Tool definitions are a cost line of their own.** Measure the first request's prefix: on the platform the tool definitions dominate it, and nearly half of them may be tools the agent never calls.
  Deny those (`Harness adapters` → tool deny list), give each fan-out a lean subagent type, and make the `tokens` event count subagent transcripts, or the audit's estimate misses their share.
- **The worklist carries the resolved config.** A pre-flight that found work emits a `config` object (every key with its default applied) so a run with work never parses `work/CONFIG.md` itself; the file is read only in the manual fallback and on an operator change.

## Autonomous effects (opt-in)

- **Off by default, granted twice**: a config key the admin enables at onboarding, plus a human-managed trigger per item (a label, an approval).
  The agent never sets the trigger itself.
- **Independent gates from fresh reads**: the agent's own verdict on the current revision, the external status (checks green, mergeable), a size cap, no path the config marks as human-only (CI config always counts), no pending human objection (read every page of the list).
  A verdict the same run changed earlier is read again, never taken from the worklist.
- **Server-side guard on the write**: pass the revision the gates read (SHA, lease, ETag), so a change in between rejects the write.
- **A refusal marks the revision and is never retried**; a transport fault or rate limit is retried next run.
- **One agent round per revision.** An agent-made change never qualifies its item for another autonomous effect, and the next human-triggered step stays human.

## Per-item cost and anomalies

A session's `tokens` event says what a run cost; it cannot say that *one item* ran away.
For an agent whose unit of work is expensive (a review, a document, a dataset):

- **Measure each item**: a hook logs one `<item>_cost` event per finished item, the API usage between its first and last milestone (subagents included) and the window's shape: `peak_ctx` (the largest single call's context), `repeats` (the most repeated identical tool call), `max_out` (the largest tool result, a result saved to a file counted at its stated size), `failures` and `secs`.
- **Limits come from the instance, not the definition**: per rule the limit is `max(floor, factor × median)` of the same model's last 30 items; cost, time and context have no floor and wait until 10 items exist, `repeats`/`failures`/`max_out` have floors so a small count never alerts on noise.
  The factor is a config key (missing = 4, `off` disables); the baseline lives in its own `work/<ITEM>-USAGE.jsonl`, so it outlives the events-log retention and a quiet instance still reaches 10.
- **Judge each item once** (a marker of the newest judged timestamp, claimed under a `mkdir` lock) and alert through the monitor with every broken rule's value, limit, median and the likely cause (repeats on a small input is a loop, a high context or cache-read share is a large resident input, a huge output is a file dump, many failures is a broken tool, a large input is legitimate).
- **The audit watches the drift the alert can't**: a chronic problem moves the median and stops alerting, so the weekly report shows each field's median against the week before and warns when one rose by half.

## Monitor — health alerts between audits

The audit is weekly; a dead schedule, a model outage, a classifier that blocks every post or a backup that stopped pushing should not wait a week.
Every agent with scheduled runs gets a **monitor**: its own frequent schedule (e.g. every 15 min) whose Precheck runs `scripts/monitor.sh`, which reads **local files only** (the events log, ledgers, the harness settings), makes no external call and costs no quota; an idle tick starts no session.
The work heartbeat decides work only and carries no health check.

- **Alert catalogue** (keep what applies, add domain conditions): `model_unavailable` / `model_recovered` (N runs ended on an availability-class `api_failure` inside one outage, failures under 60 min apart); `<integration>_unavailable` / `_recovered` (N gate passes in a row could not list the item universe); `classifier_spike` (N refusals in 24 h) and `post_blocked` (a refused outward write with no later success); `harness_drift` (`install.sh --check` names a part); `heartbeat_gap` (no gate tick for 1.5× the interval, at least 60 min); `backup_failing` (a backup error no later push cleared for 6 h); stalls and per-item anomalies when designed.
  Thresholds are config keys with working defaults (`0`/`off` disables); onboarding asks nothing.
- **The ledger** (`work/MONITOR.json`, one writer at a time): an alert is **claimed** when emitted and due again 30 min later until `monitor.sh ack <id>…` records it as sent, so a session that died before its ack loses nothing (a model outage is the usual cause).
  A sent alert is never emitted again (counted as `suppressed`); a row stays while a tick still finds its condition, else 14 days; a condition that clears leaves the ledger, so its return alerts again.
  One `alerts_due` entry per id.
- **The monitor run** sends **one message** for the whole run (what, when in UTC, the numbers, the likely cause, the one operator action if any) to the chat UI, plus a DM to the escalation owner under the notifications opt-in, never the shared channel; then acks after the send, never before, never on a failed send.
  **A signal, not a repair**: it never clears a lock, re-runs, changes a threshold or edits settings in response.
- **Direct delivery (opt-in)**: under its own key, the pass sends the due alerts itself, with no model (`scripts/lib/mcp.sh`, `references/platform-dam.md` → The MCP endpoint from a script), so a model outage or a classifier refusal cannot stop the alert about it.
  One templated DM to the escalation owner: a header and one bullet per alert from a fixed template, every value a UTC time, a whole number, a class word or an id; event text never travels; a message with any other token is not sent; at most 10 alerts and 12 calls per 24 h; a sent id is acked and leaves the worklist, a failed send leaves it to the session, an `unknown` outcome holds it for its claim time.
  This is **the one designed exception** to "scripts never act", named as such in self-modification §4; a new outward action of a script extends it or belongs to the agent.
  Alerts that need analysis (an anomaly) stay with the session.
- **Technical history** (`work/health/`, always on, 90 days, no token): one row of counts per UTC hour (gate ticks, broken gates, sessions, items, model and integration failures, classifier blocks, errors, pod boots, backup errors), one incident per condition (`first`, `last_seen`, `open`, `end`), the status of each service at the last tick.
  Counts, class words, times and ids only — never event text.
  It answers "why did the agent not run at T": no gate tick → the platform or the pod; a broken gate → the gate; a failed integration or model → them; ticks and no session → nothing was due.
  An opt-in `health_dashboard` key publishes it as one page in the Artifact Library, updated in place on a status change or every 3 h, redacted, public by link.

## Writes to the definition repo

The definition repo may be public while the target is private, so **anything the agent writes there is anonymous and generic**: a reader learns which part of the definition fails and how to fix it, never the instance (repository, organisation, people, ids, numbers, dates, paths, code, log lines, config values, anything under `work/`).

- A config key gates it (`definition_issues`, missing = disabled; onboarding asks and always writes the choice, with the repo's visibility in the question).
  Off, a finding stays in the report and the chat UI.
- **The content is a closed list**: where (definition file and section, `VERSION`), symptom in general words, a synthetic reproduction with the definition's placeholders, frequency as a count and a window, proposed fix.
  A config value appears as its key name, a channel request as the capability in general words.
- **One filing path, a script**: it applies the switch, scans title and body, dedups by title and only then creates.
  The scan blocks every instance value of `work/CONFIG.md` and the roster, every shape that points at one (a URL outside the definition repo, an issue or PR number, a SHA, a date or time of day, an e-mail, a mention, a member id, an IP, a credential) and every **foreign term**: a path, a dotted or identifier-shaped word (`snake_case`, a hyphenated compound with an unknown part, a letter followed by a digit, a letter outside ASCII), a token in backticks or a fenced block, or a capitalised word that occurs nowhere in the definition's own text.
  Outcomes `filed` / `exists` / `disabled` / `blocked` (rewrite once; a second `blocked` withholds the issue and the report says so) / `error`.
- **No other path exists**: a `PreToolUse` hook refuses any other issue write on the definition repo (CLI, REST, GraphQL, a write without a repo flag) with the script's name as the reason.
  The auto-mode rule names the script, not the write.

## Definition file inventory

Beyond the templates (kit.yaml, CLAUDE.md, AGENTS.md, ONBOARDING.md, .gitignore, VERSION, CHANGELOG.md, docs/self-modification.md, docs/persistence.md), write per-domain:

- `docs/<runtype-or-procedure>.md` — one per run type / major procedure: the exact per-item sequence, output formats, error handling, and a **self-check list** the agent walks before declaring the run done.
- `docs/preferences.md` — only if the agent learns (memory routes, consolidation bounds).
- `docs/logging.md` — when the agent keeps the structured events log: event catalogue, who writes what (script vs. agent vs. harness hook), triage guidance, and — when `scripts/lib/toolpath.sh` ships — a **Tool path resolution** section holding its rationale and measurements, which that script's header points at.
- `docs/audit.md` — the audit task list (`references/audit.md`).
- `docs/monitor.md` — the monitor run (template provided): the alert catalogue with its conditions and clears, the one-message report, the ack-after-send rule.
- `docs/health.md` — only with the technical history: the records, the service status table, the dashboard and its publish rule.
- `scripts/monitor.sh` — the monitor's detector (template provided): conditions from local files, the ledger with claims and `ack`, one JSON object; `precheck.sh monitor` runs it.
- `scripts/harness/<harness>/` — when the harness has hooks: `install.sh`, the hook scripts, `denied-tools.txt`, `agents/<lean-subagent>.md` (Logging → Harness adapters).
- `scripts/definition-issue.sh` — when the agent files issues on its definition repo (Writes to the definition repo): the switch, the scan, the dedup, the create.
- `README.md` — for humans: what it does, setup, config table, runtime requirements, external surfaces, token scopes.
- `.agents/skills/<name>/` — only when the design bundles a skill of its own (a procedure the agent invokes as a sub-task).
  It is definition content, but the harness also *installs* skills into that directory at runtime, so the `.gitignore` re-includes the bundled ones **by name** — otherwise a cached install becomes tracked.
- `scripts/verify-onboarding.sh` — post-onboarding structure verification (template provided).
  Detect-never-repair like the pre-flight: checks onboarding produced the promised *shape* (required files, required and known-only config keys, table headers, row formats, `work/` not a git repo), never the data.
  Every `FAIL` carries a `fix:`, so the agent repairs and re-runs until `PASS`.
  `--live` adds auth, reachability and one read-only pre-flight per scheduled mode.
  Run it at the end of onboarding, from any upgrade step that changes what onboarding produces, and from the weekly audit.

Keep CLAUDE.md slim: run types, contracts, config semantics, trust boundary, hard invariants, and a "map of docs/" table saying when to read what.
Split a file that outgrows its purpose: the definition is paid for in tokens on every read.
