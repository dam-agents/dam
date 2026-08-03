# Architecture of a generated agent

The structural rules every generated definition follows. Read before writing the Phase 2
proposal; cite these rules in the generated `docs/self-modification.md` rather than
restating them there at length.

## Two repos, one inside the other

| Path | Repo | Holds |
| --- | --- | --- |
| `$HOME` (`/home/agent`) | **definition repo** (`origin` = where ONBOARDING.md was fetched from, fork-aware) | `CLAUDE.md`, `ONBOARDING.md`, `README.md`, `docs/`, `scripts/`, `VERSION`, `CHANGELOG.md`, `.gitignore`, `LICENSE` |
| `$HOME/work` | optional state repo (env var, e.g. `GITHUB_REPO_WORK`) | `CONFIG.md`, `MEMORY.md`, domain state files, logs |

Why this shape works:

- `$HOME` also contains secrets (`.ssh`, `.claude`, `.config`) and `work/`. The definition
  repo is only safe at `$HOME` because its `.gitignore` is an **allowlist**: `/*` ignores
  everything, then only the definition files are re-included. `git add -A` can then never
  capture a secret or runtime state.
- Nothing under `work/` is ever tracked by the definition repo. Seed templates for state
  files live inside `ONBOARDING.md`, not as tracked files — so a definition update
  (`git fetch` + `git reset --hard origin/main`) never collides with live state.
- Two absolute prohibitions inherited by every agent: **never `git clean` in `$HOME`**
  (it would delete untracked secrets and state) and **never `git add` outside the
  allowlist**.
- Definition changes go through **branch + PR on the definition repo** — never a direct
  push to `main`, never as a side effect of a scheduled run.

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
- **Locks with TTL + takeover** — when runs can overlap, the tracking row doubles as a
  best-effort lock (`in_progress` + timestamp; stale after a TTL; the next run takes over
  and logs it). The external dedup check stays authoritative.
- **At-action-time re-checks** — the worklist says *what to do*; right before every
  irreversible effect the agent re-verifies *it is still valid* (item unchanged, gate
  still present). Use server-side guards where the API offers them.
- **Write-before-send** — for people-facing or unrepeatable effects: update the state row
  first, then act; a failed act is logged and not retried within the run.
- **Verified pruning** — remove an item's state only after per-item verification that it
  is really gone (never from absence in a list call — a truncated listing would mass-prune),
  and clean up everything the item owned (published artifacts, history files).
- **State reconstruction** — when markers exist, a lost `work/` is rebuildable: list live
  items, find the agent's markers, rewrite tracking rows with the **external-system
  timestamps** (history, not "now"). Only learned memory is unrecoverable — which is why
  it seeds from a template and is never overwritten on re-onboarding.

## State files (`work/`)

- `CONFIG.md` — instance configuration, `- key: value` bullets (parsed with `sed`, so keep
  the format exact) plus optional `##` table sections. Created by onboarding.
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

## Logging

- One append-only log per run type (`work/<RUNTYPE>.log`), one line per run:
  `<ISO-UTC> <summary counters>`. Grep-friendly by design — the audit reads these.
- Error lines share a stable prefix (`ERROR:`) so a log scan is one grep. A log whose own
  content would trip the scan (like the audit's) avoids the trigger substrings.
- Optional **debug/progress log**, gated by a config key (default off): one line per
  pipeline milestone, so a session that dies mid-item is diagnosable at the exact step.
  Diagnostic only — never gates behavior.
- Big logs are never loaded into context — `tail`/`grep` them.
- No secrets in any log, ever. All user-visible errors also land in the chat UI.

## Definition file inventory

Beyond the templates (CLAUDE.md, ONBOARDING.md, .gitignore, VERSION, CHANGELOG.md,
docs/self-modification.md, docs/persistence.md), write per-domain:

- `docs/<runtype-or-procedure>.md` — one per run type / major procedure: the exact per-item
  sequence, output formats, error handling, and a **self-check list** the agent walks
  before declaring the run done.
- `docs/preferences.md` — only if the agent learns (memory routes, consolidation bounds).
- `docs/audit.md` — the audit task list (`references/audit.md`).
- `README.md` — for humans: what it does, setup, config table, runtime requirements,
  external surfaces, token scopes.

Keep CLAUDE.md slim: run types + contracts + config semantics + trust boundary + hard
invariants + a "map of docs/" table saying when to read what. Every concept has exactly
one home; everywhere else at most one line + a link. When a file grows past its purpose,
split it — the definition is paid for in tokens on every read.
