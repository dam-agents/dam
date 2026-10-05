# Phase 1 — Domain interview

Goal: everything the Phase 2 proposal needs. A conversation in the user's language: batch
related questions, propose defaults, skip what earlier answers settled, and push back when
an answer conflicts with a platform constraint (cite `references/platform-dam.md`). Each
block lists **what its answers determine**; use that when assembling the design brief.

## 1. Mission & identity

- What does the agent do, in one sentence? Who is it for?
- Pick a name: kebab-case (`ticket-triage`, `changelog-guardian`) → `{{AGENT_NAME}}`; a
  human display name it signs public output with → `{{AGENT_DISPLAY_NAME}}` (a config key,
  cosmetic only).

Determines: repo name, sentinel name (`.$AGENT_NAME-onboarded`), log prefixes, schedule
name prefixes, git identity for state commits.

## 2. Unit of work

The most load-bearing answer: what the agent processes (a PR, ticket, document, alert,
channel question, dataset row).

- How is one item identified (number, ID, URL)? Is the ID stable?
- How do new items appear, and how does the agent notice (poll a list API? a channel
  message? both)?
- What does "already handled" mean, and where can that fact live **in the external
  system** (posted marker, label, status field)? If nowhere, only local state holds it:
  state loss means reprocessing, so a backup repo becomes near-mandatory. Say so.
- Processed once, or again on change? What signals "changed"? Automatic or human-gated
  re-processing (label gate: new activity only flips a row to "awaiting"; a human action
  triggers the re-run)?
- Can an item disappear (closed/merged/deleted)? What cleanup does that require?

Determines: worklist entry shape, the tracking state file (one row per item: id,
version/SHA, timestamp, outcome, status), the dedup marker format, prune procedure,
re-run gating.

## 3. Inputs (read integrations)

- Which systems does it read, through what surface (`gh` CLI, MCP tool, plain HTTPS)? Is
  it reachable from the pod (`references/platform-dam.md`; GitHub is the well-trodden
  default with known workarounds)?
- Items per day/week? Cost of one listing call; is there one batched call that sees
  everything (one REST list call is ideal)?

Determines: pre-flight feasibility and cost, `kit.yaml` `connections:` and which are
`required` (a missing required one refuses the create), README runtime requirements.

## 4. Effects (write integrations)

For every write the agent performs (post a comment, send a message, update a field,
publish a file, open a PR):

- **Externally visible / hard to reverse**? Then it gets an action-time freshness
  re-check, a dedup guard and a log line.
- Where does its **idempotency marker** live (proven pattern: a hidden marker in the posted
  body carrying item id + content version)?
- Partial failure (posted not recorded / recorded not posted): which is worse for *this*
  effect, a duplicate or a silent drop? **Write-before-send** when a duplicate is worse
  (publishing, paying, irreversible writes), **send-then-record** when a drop is worse
  (messages, replies, nudges). Don't default; the choice decides an audit check
  (`references/architecture.md` → Record ordering).
- Publishing to a public/semi-public surface → call it out: documented in README and off
  by default unless it is the agent's core purpose.

Determines: hard invariants, state-row lifecycle, audit checks, config keys that gate
features.

## 5. Run model

Don't assume a heartbeat; offer the models:

- **Scheduled**: cron runs, one or more run types with their own cadence, each a pre-flight
  mode (`references/preflight.md`). Ask cadence and whether to respect working hours.
- **Reactive (channel-driven)**: acts on messages in a connected channel. No pre-flight;
  CLAUDE.md's request-handling contract plays that role.
- **On-demand**: the operator triggers work in the direct session.
- **Hybrid**: most real agents are scheduled + a small reactive surface.

Always recommend the scheduled **weekly audit** (`references/audit.md`); for a purely
reactive agent it is usually the only schedule.

Determines: run-types table in CLAUDE.md, the `schedules:` block in `kit.yaml` (and which
of them ship suggested-off), ONBOARDING's check-then-create fallback, whether
`scripts/preflight.sh` and its Precheck adapter exist, cost envelope.

## 6. People & channels

- Does it message people, on which supported channel (Slack, Telegram)?
- Split **responsive** (answering inbound, always allowed) from **proactive** (nudges,
  reports, escalations: strictly opt-in behind a config key, default disabled).
- @-mentions need a roster state file (the only mentionable set, operator-maintained), and
  an escalation owner if reminders escalate.
- Which channel requests may trigger real work? That is the **trust-boundary exception
  whitelist**: minimal and explicit (e.g. "process item #N now"). Everything else from a
  channel is answered, never obeyed (`references/communication.md`).

Determines: communication config keys, roster file + its onboarding step, trust-boundary
section content, shepherd-style run type if periodic nudging emerged here.

## 7. State & backup

- Beyond block 2's tracking file, what must persist (memory, per-item history, ledgers,
  caches)?
- What is reconstructable from external markers (block 4) and what isn't (learned memory
  never is)? The unreconstructable part decides how much backup matters.
- Backup: a dedicated git repo for `work/` (recommended: an env var like
  `GITHUB_REPO_WORK`, persisted via `work-backup.sh persist` as the last action of every
  run) or local-only (volume persistence, reconstruct-on-loss)?

Determines: `work/` inventory, seed templates embedded in ONBOARDING, the state
reconstruction step, persistence doc content, end-of-run persist step.

## 8. Configuration

- What differs between two deployments (target repo/project/board, names, markers, labels,
  feature toggles)? Each becomes a `work/CONFIG.md` key with default, missing-key behavior,
  and whether it is **immutable once used** (anything woven into dedup markers is).
- Which env vars override which keys (env var always wins)?

Determines: Runtime configuration section of CLAUDE.md, the ONBOARDING config dialog
(ask → validate → default, keep existing values on re-onboarding).

## 9. Cost envelope

- Run frequency and items on a busy day? Multiply: a 10-minute heartbeat is ~144 runs/day,
  so anything done per run happens 144×.
- What fraction of runs find nothing? That fraction should cost ~zero (Precheck /
  `nothing_to_do` short-circuit).
- Agree what is script vs agent judgment. For an expensive ask, propose the cheaper
  equivalent and let them choose.

Determines: cadences, pre-flight scope, how much batching the design needs.

## 10. Kit & catalog

The repo is its own Starter Kit, so a few answers decide what the operator never does by
hand (`references/kit.md`). Blocks 3–8 settle most; confirm rather than re-ask.

- **Catalog presentation**: display name, one-line tagline, category (`knowledge` /
  `software` / `productivity` / `research`).
- **Hard-required connections**: they refuse the create when missing, so anything behind
  an opt-in config key is suggested, not required.
- **Schedules shipped on**: an enabled schedule fires as soon as onboarding completes.
  Anything people-facing ships suggested-off, like every proactive surface.
- **Size and cadence**: more than the install default (CPU, memory, workspace disk, and
  why)? A heartbeat finer than the idle timeout, so the agent should hibernate later
  instead of paying a wake-up per tick?
- **Publication**: the repo must be **public** to be its own kit (catalogs are read
  anonymously). If it can't be, say so now: the kit then lives in the catalog repo and
  points at the private definition; the other answers are unchanged.
- **Fixed env**: anything every deployment shares (rare). What differs between
  deployments stays a block 8 config key.

Determines: `kit.yaml` in full, the Phase 6 handoff, and how much of ONBOARDING is a
fallback path rather than the normal one.

## Wrap-up — the design brief

Summarize into a short brief and get a "yes": mission, name, unit of work + lifecycle,
integrations (read/write) with idempotency markers, run model + cadences, channels +
proactive opt-ins + trust exceptions, state files + backup choice, config keys, the kit
surface, cost notes. This brief feeds Phase 2.
