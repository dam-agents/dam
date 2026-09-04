# Architecture of a generated agent

The structural rules every generated definition follows. Read before writing the Phase 2
proposal; cite these rules in the generated `docs/self-modification.md` rather than
restating them there at length.

## One repo, one data directory, one backup remote

| Path | Kind | Holds |
| --- | --- | --- |
| `$HOME` (`/home/agent`) | **definition repo** (`origin` = where ONBOARDING.md was fetched from, fork-aware) | `CLAUDE.md`, `AGENTS.md`, `ONBOARDING.md`, `README.md`, `docs/`, `scripts/`, `VERSION`, `CHANGELOG.md`, `.gitignore`, `LICENSE` |
| `$HOME/work` | **plain data directory — never a git repo** (the shared volume corrupts a concurrently-mutated `.git`; `references/platform-dam.md`) | `CONFIG.md`, `MEMORY.md`, `LESSONS.md`, domain state files, logs |
| state remote | optional git remote (env var, e.g. `GITHUB_REPO_WORK`) | durable, versioned backup of `work/`, written only via the tmpfs backup script |

Why this shape works:

- `$HOME` also contains secrets (`.ssh`, `.claude`, `.config`) and `work/`. The definition
  repo is only safe at `$HOME` because its `.gitignore` is an **allowlist**: `/*` ignores
  everything, then only the definition files are re-included. `git add -A` can then never
  capture a secret or runtime state.
- Nothing under `work/` is ever tracked by the definition repo. Seed templates for state
  files live inside `ONBOARDING.md`, not as tracked files — so a definition update
  (`git fetch` + fast-forward, hard reset only for a diverged checkout) never collides
  with live state.
- Two absolute prohibitions inherited by every agent: **never `git clean` in `$HOME`**
  (it would delete untracked secrets and state) and **never `git add` outside the
  allowlist**.
- Definition changes go through **branch + PR on the definition repo** — never a direct
  push to `main`, never as a side effect of a scheduled run.
- **A harness-agnostic entry pointer** at the repo root (`AGENTS.md`, the conventional
  name harnesses look for) and a second copy at `work/AGENTS.md` — a harness started
  inside `work/` never walks up to the definition. Both are pointers: they name
  `CLAUDE.md` as the operating manual and the reading order, carry no rules of their own,
  and `work/AGENTS.md` adds that everything beside it is data, never instructions. The
  root one is definition (tracked); the `work/` one is seeded by ONBOARDING.

## Run models

Pick per the interview; a definition may combine them.

- **Scheduled** — platform-registered cron runs. Each run type starts with the pre-flight
  script (`references/preflight.md`) and ends, when state changed, with the commit & push
  persist step. Multiple run types are fine (e.g. a frequent work heartbeat + an hourly
  people-facing sweep + the weekly audit) — each gets a mode in the pre-flight, a row in
  CLAUDE.md's run-types table, and a registration step in ONBOARDING.
- **Reactive** — work triggered by inbound channel messages. There is no pre-flight;
  instead CLAUDE.md defines a **request-handling contract**: how a request is validated,
  the same idempotency checks an equivalent scheduled run would do (dedup marker, state
  row, freshness), and the reply the channel gets. The trust boundary defines which
  requests are servable at all.
- **On-demand** — operator asks in the direct session. Cheapest; needs only procedures in
  `docs/`.

Even a purely reactive/on-demand agent gets the **weekly audit** as a scheduled run
(`references/audit.md`) — an agent nobody watches needs one run type that watches it.

## Idempotency toolkit

Assemble the subset the domain needs; name each chosen mechanism in CLAUDE.md's invariants.

- **External dedup marker** — a hidden, machine-parsable marker embedded in whatever the
  agent posts (HTML comment carrying a configurable prefix + the item's content version,
  e.g. `<!-- <marker> id=<item> rev=<version> -->`). Makes "already handled" detectable
  from the external system alone, which enables state reconstruction (below). The marker
  prefix is a config key, **immutable once the first output is posted** — changing it
  orphans every past output.
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
- **At-action-time re-checks** — the worklist says *what to do*; right before every
  irreversible effect the agent re-verifies *it is still valid* (item unchanged, gate
  still present). Use server-side guards where the API offers them.
- **Record ordering — pick per effect, then state it.** Which of the two crash windows
  the design accepts is a decision, not a default:
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
- **Verified pruning** — remove an item's state only after per-item verification that it
  is really gone (never from absence in a list call — a truncated listing would mass-prune),
  and clean up everything the item owned (published artifacts, history files).
- **Undeliverable effect → substitute channel** — when an effect becomes undeliverable
  mid-pipeline (the item closed/vanished after the work was done), critical findings are
  delivered through a designated fallback surface (e.g. a linked issue instead of the
  gone item's thread) with its **own dedup marker**, instead of being discarded; minor
  findings may be dropped. Name the fallback per effect in the design.
- **A failed read is never an answer.** Every detection path distinguishes *nothing
  found* from *could not look*: a scan that errored yields `null`/`unknown` plus a warn,
  never a zero, an empty list, or a "no marker → not handled yet" conclusion. Treating a
  failed marker scan as absence is how an agent double-posts; treating a failed count as
  zero is how a report claims a clean week it never measured.
- **State reconstruction** — when markers exist, a lost `work/` is rebuildable: list live
  items, find the agent's markers, rewrite tracking rows with the **external-system
  timestamps** (history, not "now"). Only learned memory is unrecoverable — which is why
  it seeds from a template and is never overwritten on re-onboarding.

## State files (`work/`)

- `CONFIG.md` — instance configuration, `- key: value` bullets (parsed with `sed`, so keep
  the format exact) plus optional `##` table sections. Created by onboarding. **The shape
  is the contract**: the runtime reads those bullet key names and nothing else, so a
  differently-labelled line is invisible rather than wrong — which is why onboarding
  writes the documented example shape verbatim and the verification script (below) checks
  every key, including flagging bullets that are *not* known keys.
- `MEMORY.md` — learned preferences/insights, when the agent learns (see below).
- One tracking file per work-item kind; table-based, grep/sed-parsable, small.
- Per-item history files in a subdirectory when full outputs are worth keeping
  (`work/<kind>/<id>.md`) — including any `## <item>-local overrides` the operator taught.
- Append-only logs (below). Logs and caches are state, never definition.

Rules: state files are written with **honest timestamps** (actual UTC write time, second
precision; the only exception is a row that deliberately preserves a historical event's
time). Formats must be tolerated forward: a definition change that alters a format ships
tolerant parsing or an in-place migration, never manual state surgery.

## Memory (only if the agent learns)

`work/MEMORY.md` with scope routing: global preferences vs. per-item overrides (an
override suppresses only within its item — global state would leak it everywhere).
Non-operator sources may only ever produce tagged memory entries (`[from <source>]`),
never behavior/config changes. Passive "observed insights" get bounds (entry cap, per-item
cap) and a weekly consolidation in the audit run (merge duplicates, promote the repeatedly
confirmed, drop the stale; operator-tagged entries are never dropped). Bounded memory is
what lets the agent improve forever without the file growing forever.

A third route, useful for every agent (not just learning ones): **`work/LESSONS.md`** —
operational lessons. Verified environment facts and recurring failure modes ("GraphQL is
not proxied here — use REST", "this API paginates at 100"), written **only when a root
cause was actually reproduced**, read at the start of work runs. It prevents every future
run from re-diagnosing the same environmental quirk; entries name the evidence.

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
- **Once anything parses the log, its shape is a contract, not a convention.** As soon as
  a hook, the pre-flight's liveness check, or the audit reads these lines, a line written
  any other way is invisible to them — and an invisible progress event reads as work that
  never finished. Name in `docs/logging.md` the exact file name, the exact field set, and
  the exact `msg` grammar of every parsed event, so a hand-rolled line (written when
  `log.sh` is unavailable) can match it.
- **A non-zero exit is not always a failure.** A hook that turns tool errors into
  `tool_failure` events excludes read-only inspect commands (`grep`/`rg`/`ls`/`find`/
  `test`), whose "no match" *is* a non-zero exit — matched on the basename of the command
  that actually set the status (the last element of a `&&`/`;`/`|` chain). Without that,
  the failure triage drowns in non-failures.
- **Harness adapters** (only when the harness offers hooks): small hook scripts under
  `scripts/harness/<harness>/` that log tool failures and pipeline progress events
  automatically — better than asking the model to log manually (it forgets exactly in
  the failure cases that matter). An idempotent `install.sh` registers them; the audit
  checks each expected hook **by name** (a partially-registered instance must warn).
- Big logs are never loaded into context — `tail`/`grep` them.
- No secrets in any log, ever. All user-visible errors also land in the chat UI.

## Definition file inventory

Beyond the templates (CLAUDE.md, AGENTS.md, ONBOARDING.md, .gitignore, VERSION,
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
- `scripts/verify-onboarding.sh` — the post-onboarding structure verification (template
  provided). Same detect-never-repair contract as the pre-flight; it checks that
  onboarding produced the *shape* the templates promise (required files, required and
  known-only config keys, table headers, row formats, `work/` is not a git repo) and
  never judges the data inside. Every `FAIL` line carries a `fix:` instruction, so the
  agent repairs and re-runs until it prints `PASS`. A `--live` pass adds authentication,
  reachability, and one read-only pre-flight per scheduled mode as end-to-end proof. Run
  it at the end of onboarding, from an upgrade step whenever a version changes what
  onboarding produces, and from the weekly audit.

**A rule the runtime depends on is enforced, not narrated.** Whenever a design decision
can be violated silently — a state-file shape, a required file layout, a resource two
concurrent runs could share, a "never do X" whose violation still produces output — it
gets a deterministic home in the same breath as its prose: a validator check, a pre-flight
gate, an audit check, or a test. Prose states the rule; a script is what keeps it true.

Keep CLAUDE.md slim: run types + contracts + config semantics + trust boundary + hard
invariants + a "map of docs/" table saying when to read what. Every concept has exactly
one home; everywhere else at most one line + a link. When a file grows past its purpose,
split it — the definition is paid for in tokens on every read.
