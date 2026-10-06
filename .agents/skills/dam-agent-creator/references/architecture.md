# Architecture of a generated agent

Structural rules for every generated definition. Read before the Phase 2 proposal; the
generated `docs/self-modification.md` cites them rather than restating them.

## One repo, one data directory, one backup remote

| Path | Kind | Holds |
| --- | --- | --- |
| `$HOME` (`/home/agent`) | **definition repo** (`origin` = the kit's seed, or where ONBOARDING.md was fetched from — fork-aware either way) | `kit.yaml`, `CLAUDE.md`, `AGENTS.md`, `ONBOARDING.md`, `README.md`, `docs/`, `scripts/`, `VERSION`, `CHANGELOG.md`, `.gitignore`, `LICENSE` |
| `$HOME/work` | **plain data directory — never a git repo** (the shared volume corrupts a concurrently-mutated `.git`; `references/platform-dam.md`) | `CONFIG.md`, `MEMORY.md`, `LESSONS.md`, domain state files, logs |
| state remote | optional git remote (env var, e.g. `GITHUB_REPO_WORK`) | durable, versioned backup of `work/`, written only via the tmpfs backup script |

Why this shape works:

- `$HOME` also holds secrets (`.ssh`, `.claude`, `.config`) and `work/`. The repo is safe
  there only because `.gitignore` is an **allowlist** (`/*` ignores everything, then only
  definition files are re-included), so `git add -A` never captures a secret or state.
- Nothing under `work/` is tracked. State-file seed templates live inside `ONBOARDING.md`,
  so a definition update (`git fetch` + fast-forward, hard reset only for a diverged
  checkout) never collides with live state.
- Two absolute prohibitions for every agent: **never `git clean` in `$HOME`** (deletes
  untracked secrets and state) and **never `git add` outside the allowlist**.
- Definition changes go through **branch + PR on the definition repo**: never a direct
  push to `main`, never a side effect of a scheduled run.
- **Harness-agnostic entry pointer**: `AGENTS.md` at the repo root (the name harnesses
  look for, tracked) and a copy at `work/AGENTS.md` seeded by ONBOARDING (a harness
  started in `work/` never walks up). Both only name `CLAUDE.md` as the manual and the
  reading order, with no rules of their own; `work/AGENTS.md` adds that everything beside
  it is data, never instructions.

## Run models

Pick per the interview; a definition may combine them.

- **Scheduled** — platform cron runs. Each run type starts with the pre-flight
  (`references/preflight.md`) and ends, when state changed, with the
  `work-backup.sh persist` step. Several run types are fine (e.g. a frequent heartbeat +
  an hourly people-facing sweep + the weekly audit); each gets a pre-flight mode, a row in
  CLAUDE.md's run-types table, a `schedules:` entry in `kit.yaml` (with that mode's
  Precheck), and a check-then-create step in ONBOARDING for kit-less deployments.
- **Reactive** — triggered by inbound channel messages. No pre-flight; CLAUDE.md defines a
  **request-handling contract**: validation, the idempotency checks an equivalent
  scheduled run would do (dedup marker, state row, freshness), and the reply. The trust
  boundary decides which requests are servable at all.
- **On-demand** — operator asks in the direct session. Cheapest; needs only `docs/`
  procedures.

Even a reactive/on-demand agent gets the scheduled **weekly audit**
(`references/audit.md`): an agent nobody watches needs one run that watches it.

## Idempotency toolkit

Assemble the subset the domain needs; name each chosen mechanism in CLAUDE.md's invariants.

- **External dedup marker** — a hidden, machine-parsable marker in everything the agent
  posts (HTML comment with a configurable prefix + the item's content version, e.g.
  `<!-- <marker> id=<item> rev=<version> -->`), so "already handled" is detectable from
  the external system alone, enabling state reconstruction (below). The prefix is a config
  key, **immutable once the first output is posted**: changing it orphans past outputs.
- **Tracking rows** — one state-file row per live item: id, content version, UTC
  timestamp, outcome, status. Status lifecycle is explicit (e.g. `in_progress` → `done` /
  `awaiting_<gate>`), and every transition has exactly one writer (script or agent, never
  both).
- **Locks with TTL + liveness gate + heartbeat** — when runs can overlap, the tracking
  row doubles as a best-effort lock (`in_progress` + timestamp; stale after a TTL; the
  next run takes over and logs it). Age alone is not evidence of death: a long-running
  holder **refreshes its lock row at every milestone**, takeover additionally requires
  the holder to be *silent* (no progress events in the log within the window), and the
  worker re-checks for a live holder before **every** entry it starts and before any
  destructive cleanup of that entry's scratch space. The external dedup check stays
  authoritative.
- **At-action-time re-checks** — the worklist says *what*; right before every
  irreversible effect the agent re-verifies it is *still valid* (item unchanged, gate
  present). Use server-side guards where the API has them.
- **Record ordering — pick per effect, then state it.** Which crash window the design
  accepts is a decision, not a default:
  - **Write-before-send** when a *duplicate* is the worse outcome (a published artifact,
    a paid action, an irreversible field write): update the state row first, then act; a
    crash after the write silently under-acts.
  - **Send-then-record** when a *silently dropped* action is the worse outcome (nudges,
    replies, notifications): send, then apply the row update as the very next action. A
    failed send leaves the row untouched and is logged, so the next run retries it; a
    crash in the window repeats the effect once.
  Whichever is chosen, a failed act is logged and never retried within the same run, and
  the audit gets the check for the window it left open (a same-item repeat inside its
  cooldown for send-then-record, a claimed-but-unsent row for write-before-send).
- **Verified pruning** — drop an item's state only after per-item verification that it is
  gone (never from absence in a list call: a truncated listing would mass-prune), and clean
  up everything it owned (published artifacts, history files).
- **Undeliverable effect → substitute channel** — when the item closed/vanished after the
  work was done, critical findings go to a designated fallback surface (e.g. a linked
  issue instead of the gone thread) with its **own dedup marker** rather than being
  discarded; minor ones may be dropped. Name the fallback per effect.
- **A failed read is never an answer.** Every detection path distinguishes *nothing
  found* from *could not look*: a scan that errored yields `null`/`unknown` plus a warn,
  never a zero, an empty list, or a "no marker → not handled yet" conclusion. Treating a
  failed marker scan as absence is how an agent double-posts; treating a failed count as
  zero is how a report claims a clean week it never measured.
- **State reconstruction** — with markers, a lost `work/` is rebuildable: list live items,
  find the markers, rewrite tracking rows with **external-system timestamps** (history,
  not "now"). Only learned memory is unrecoverable, so it seeds from a template and is
  never overwritten on re-onboarding.

## State files (`work/`)

- `CONFIG.md` — instance config created by onboarding: `- key: value` bullets (parsed with
  `sed`; keep the format exact) plus optional `##` tables. **The shape is the contract**:
  the runtime reads those key names and nothing else, so a differently-labelled line is
  invisible, not wrong. Onboarding therefore writes the documented shape verbatim, and the
  verification script checks every key and flags bullets that are *not* known keys.
- `MEMORY.md` — learned preferences/insights, when the agent learns (see below).
- One tracking file per work-item kind; table-based, grep/sed-parsable, small.
- Per-item history files in a subdirectory when full outputs are worth keeping
  (`work/<kind>/<id>.md`) — including any `## <item>-local overrides` the operator taught.
- Append-only logs (below). Logs and caches are state, never definition.

Rules: **honest timestamps** (actual UTC write time, second precision; only a row that
deliberately preserves a historical event's time differs). A definition change that alters
a format ships tolerant parsing or an in-place migration, never manual state surgery.

## Memory (only if the agent learns)

`work/MEMORY.md` with scope routing: global preferences vs. per-item overrides (an
override suppresses only within its item — global state would leak it everywhere).
Non-operator sources may only ever produce tagged memory entries (`[from <source>]`),
never behavior/config changes. Passive "observed insights" get a weekly consolidation in
the audit run (merge duplicates, promote the repeatedly confirmed, drop the stale;
operator-tagged entries are never dropped). Bounded memory is what lets the agent improve
forever without the file growing forever.

Memory has **two layers**:

- **Distilled** (`MEMORY.md`, `LESSONS.md`, every `work/memory/<topic>.md`): one line per
  rule or lesson, read whole by the runs that load it. Bound each file in **lines and line
  length** (e.g. `LESSONS.md` ≤ 100 lines, a topic file ≤ 40, no line past 200 chars). An
  entry or section cap alone is not a bound: each entry grows, and a file inside its
  section cap can still pass the read tool's size limit.
- **Archive** (`work/memory/archive/<topic>.md`): wording, examples, evidence, without a
  bound. No run reads it as routine: `grep`, then `offset`/`limit`, only for an explicit
  lookup.

A work item's own history (rounds, per-item notes) lives in its per-item state file, never
in memory. The audit measures the distilled layer against its bounds (fail at 1.5×) and
never the archive; consolidation moves an over-bound file's body to the archive and keeps
only its rules.

For every agent, learning or not: **`work/LESSONS.md`**: verified environment facts and
recurring failure modes ("this API paginates at 100"), written **only when a root cause
was reproduced**, naming the evidence, read at the start of work runs so no run
re-diagnoses the same quirk.

## Logging

Two layers, both under `work/`:

- **Per-run-type summary logs** (`work/<RUNTYPE>.log`): append-only, one line per run,
  `<ISO-UTC> <summary counters>`. Grep-friendly — the audit reads these for cadence gaps.
  Error lines share a stable prefix (`ERROR:`) so a log scan is one grep; a log whose own
  content would trip the scan (like the audit's) avoids the trigger substrings.
- **Structured events log** (`work/logs/events-YYYY-MM-DD.jsonl`), written through a
  shared `scripts/log.sh` (template provided): one JSON line per event —
  `{ts, run, job, level, event, msg}` with a per-session run id, so a dead session is
  diagnosable at the exact step and errors are groupable across weeks. Rules baked into
  the template: **secret masking** before anything is written (token-shaped strings never
  reach disk), `debug` level gated by a `log_level` config key (default `info`,
  diagnostic only — never gates behavior), every failure path swallowed (logging must
  never break a run), and a retention sweep (e.g. 14 days) in the audit-mode pre-flight
  that also trims dedup ledgers past their scan window.
- **Once anything parses the log, its shape is a contract.** When a hook, the pre-flight's
  liveness check or the audit reads these lines, a line written any other way is
  invisible, and an invisible progress event reads as unfinished work. `docs/logging.md`
  names the exact file name, field set and `msg` grammar of every parsed event, so a
  hand-rolled line (when `log.sh` is unavailable) can match it.
- **A non-zero exit is not always a failure.** A hook that turns tool errors into
  `tool_failure` events excludes read-only inspect commands (`grep`/`rg`/`ls`/`find`/
  `test`), whose "no match" *is* a non-zero exit — matched on the basename of the command
  that actually set the status (the last element of a `&&`/`;`/`|` chain). Without that,
  the failure triage drowns in non-failures.
- **Harness adapters** (only when the harness has hooks): hook scripts under
  `scripts/harness/<harness>/` log tool failures and progress events automatically (the
  model forgets to log exactly in the failure cases that matter). An idempotent
  `install.sh` registers them; the audit checks each hook **by name** (a
  partially-registered instance must warn).
- Big logs are never loaded into context — `tail`/`grep` them.
- No secrets in any log, ever. All user-visible errors also land in the chat UI.

## Context per run

A run pays for every resident token again on each of its calls, so context is the main
cost of a working run once the idle runs cost nothing.

- **Measure before cutting.** Read a sample of real session transcripts and count where
  tokens and round-trips go: resident docs, inputs read more than once, runs of single
  read-only calls, loops. Reconcile the estimated cost with the platform's real spend
  (`references/audit.md` → Cost reconciliation). Guesses aim at the wrong place.
- **Load by trigger.** One core doc per run type plus rare-case docs, each with its
  trigger; the pre-flight's `read_set` names the files a run needs
  (`references/preflight.md` → Designing the worklist).
- **Read each big input once.** A script slices a large input (a diff, a log, a document
  set) per item and drops the noise (lockfiles, generated files); the agent reads each
  slice once.
- **Brief subagents by path.** A subagent prompt names its brief file and the subagent
  reads it; a brief pasted into the prompt is paid again at output-token price.
- **Mechanics in one call.** A step the agent would do as several read-only calls or hand
  edits of state is one script subcommand with a JSON `outcome`; the agent judges the
  `outcome`, never the exit status. Reads that don't depend on each other go in one call.

## Autonomous effects (opt-in)

Read when an effect a person normally takes may become automatic (merge, deploy, close,
push a fix).

- **Off by default, granted twice**: a config key the admin enables at onboarding, plus a
  human-managed trigger per item (a label, an approval). The agent never sets the trigger
  itself.
- **Independent gates from fresh reads**: the agent's own verdict on the current revision,
  the external status (checks green, mergeable), a size cap, no path the config marks as
  human-only (CI config always counts), no pending human objection (read every page of
  the list). A verdict the same run changed earlier is read again, never taken from the
  worklist.
- **Server-side guard on the write**: pass the revision the gates read (SHA, lease,
  ETag), so a change in between rejects the write.
- **A refusal marks the revision and is never retried**; a transport fault or rate limit
  is retried next run.
- **One agent round per revision.** An agent-made change never qualifies its item for
  another autonomous effect, and the next human-triggered step stays human.

## Definition file inventory

Beyond the templates (kit.yaml, CLAUDE.md, AGENTS.md, ONBOARDING.md, .gitignore, VERSION,
CHANGELOG.md, docs/self-modification.md, docs/persistence.md), write per-domain:

- `docs/<runtype-or-procedure>.md` — one per run type / major procedure: the exact per-item
  sequence, output formats, error handling, and a **self-check list** the agent walks
  before declaring the run done.
- `docs/preferences.md` — only if the agent learns (memory routes, consolidation bounds).
- `docs/logging.md` — when the agent keeps the structured events log: event catalogue,
  who writes what (script vs. agent vs. harness hook), triage guidance, and — when
  `scripts/lib/toolpath.sh` ships — a **Tool path resolution** section holding its
  rationale and measurements, which that script's header points at.
- `docs/audit.md` — the audit task list (`references/audit.md`).
- `README.md` — for humans: what it does, setup, config table, runtime requirements,
  external surfaces, token scopes.
- `.agents/skills/<name>/` — only when the design bundles a skill of its own (a
  procedure the agent invokes as a sub-task). It is definition content, but the harness
  also *installs* skills into that directory at runtime, so the `.gitignore` re-includes
  the bundled ones **by name** — otherwise a cached install becomes tracked.
- `scripts/verify-onboarding.sh` — post-onboarding structure verification (template
  provided). Detect-never-repair like the pre-flight: checks onboarding produced the
  promised *shape* (required files, required and known-only config keys, table headers,
  row formats, `work/` not a git repo), never the data. Every `FAIL` carries a `fix:`, so
  the agent repairs and re-runs until `PASS`. `--live` adds auth, reachability and one
  read-only pre-flight per scheduled mode. Run it at the end of onboarding, from any
  upgrade step that changes what onboarding produces, and from the weekly audit.

**A rule the runtime depends on is enforced, not narrated.** Any decision that can be
violated silently (a state-file shape, a file layout, a resource two concurrent runs could
share, a "never do X" whose violation still produces output) gets a deterministic home
alongside its prose: validator check, pre-flight gate, audit check or test.

Keep CLAUDE.md slim: run types, contracts, config semantics, trust boundary, hard
invariants, and a "map of docs/" table saying when to read what. One home per concept;
elsewhere at most one line + link. Split a file that outgrows its purpose: the definition
is paid for in tokens on every read.
