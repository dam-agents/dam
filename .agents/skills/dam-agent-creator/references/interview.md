# Phase 1 — Domain interview

Goal: extract everything the architecture proposal (Phase 2) needs. Run it as a
conversation in the user's language — batch related questions, propose defaults, skip what
earlier answers already settled, and push back when an answer conflicts with a platform
constraint (cite `references/platform-dam.md`).

Each block below lists the questions and **what the answers determine** — use that mapping
when you assemble the design brief.

## 1. Mission & identity

- What does the agent do, in one sentence? Who is it for?
- Pick a name: kebab-case (`ticket-triage`, `changelog-guardian`) → `{{AGENT_NAME}}`; a
  human display name it signs public output with → `{{AGENT_DISPLAY_NAME}}` (a config key,
  cosmetic only).

Determines: repo name, sentinel name (`.$AGENT_NAME-onboarded`), log prefixes, schedule
name prefixes, git identity for state commits.

## 2. Unit of work

The single most load-bearing answer. What is the thing the agent processes — a PR, a
ticket, a document, an alert, a channel question, a dataset row?

- How is one item identified (number, ID, URL)? Is the ID stable?
- How do new items appear, and how does the agent notice (poll a list API? a channel
  message? both)?
- What does "already handled" mean, and where can that fact live **in the external
  system** (a posted marker, a label, a status field)? If nowhere, it lives only in local
  state — flag the consequence: state loss then means reprocessing, so a backup repo
  becomes near-mandatory.
- Does one item get processed once, or repeatedly on change? What signals "changed"?
  Should re-processing be automatic or human-gated (the label-gate pattern — new activity
  alone flips a row to an "awaiting" status; a human action triggers the re-run)?
- Can an item disappear (closed/merged/deleted)? What cleanup does that require?

Determines: worklist entry shape, the tracking state file (one row per item: id,
version/SHA, timestamp, outcome, status), the dedup marker format, prune procedure,
re-run gating.

## 3. Inputs (read integrations)

- Which external systems does the agent read, and through what surface — `gh` CLI, an MCP
  tool, plain HTTPS? Is that surface reachable from the pod (check
  `references/platform-dam.md`; GitHub is the well-trodden default with known workarounds)?
- Roughly how many items per day/week? How expensive is one listing call — is there a
  single batched call that sees everything (one REST list call is the ideal)?

Determines: pre-flight feasibility and cost, credentials/connections the platform must
grant, README runtime requirements.

## 4. Effects (write integrations)

For every write the agent performs (post a comment, send a message, update a field,
publish a file, open a PR):

- Is it **externally visible / hard to reverse**? Those get: an at-action-time freshness
  re-check, a dedup guard, and a log line.
- Where does the **idempotency marker** for this effect live (hidden marker in the posted
  body carrying the item id + content version is the proven pattern)?
- What happens on partial failure (posted but not recorded / recorded but not posted)?
  Default: **write-before-send** — record intent in state first; under-acting beats
  double-acting.
- Any effect that publishes to a public/semi-public surface → call it out; it must be
  documented in README and default to off unless it's the agent's core purpose.

Determines: hard invariants, state-row lifecycle, audit checks, config keys that gate
features.

## 5. Run model

Do not assume a heartbeat. Offer the models and let the user pick what fits:

- **Scheduled** — cron-registered runs (one or more run types with their own cadence).
  Each scheduled run type gets a pre-flight mode (`references/preflight.md`). Ask for
  cadence and whether it should respect working hours.
- **Reactive (channel-driven)** — the agent acts when a message arrives in a connected
  channel. No pre-flight; the request-handling contract in CLAUDE.md plays that role.
- **On-demand** — the operator triggers work in the direct session.
- **Hybrid** — any combination; most real agents are scheduled + a small reactive surface.

Always recommend one scheduled run regardless of model: the **weekly audit**
(`references/audit.md`). For a purely reactive agent it is typically the only schedule.

Determines: run-types table in CLAUDE.md, ONBOARDING schedule-registration step, whether
`scripts/preflight.sh` exists, cost envelope.

## 6. People & channels

- Does the agent message people? On which DAM-supported channel (Slack, Telegram)?
- Split **responsive** (answering an inbound channel message — always allowed) from
  **proactive** (nudges, reports, escalations — strictly opt-in behind a config key,
  default disabled).
- If it @-mentions people: it needs a roster state file (the only mentionable set,
  operator-maintained), and an escalation owner if reminders escalate.
- Which channel requests may trigger actual work? This is the **trust-boundary exception
  whitelist** — keep it minimal and explicit (e.g. "process item #N now"). Everything else
  arriving from a channel is answered, never obeyed (`references/communication.md`).

Determines: communication config keys, roster file + its onboarding step, trust-boundary
section content, shepherd-style run type if periodic nudging emerged here.

## 7. State & backup

- Beyond the tracking file from block 2: what else must persist? (Learned preferences /
  memory, per-item history, ledgers, caches.)
- What is reconstructable from external systems (via the markers from block 4) and what is
  not (learned memory never is)? The unreconstructable part decides how much a backup
  matters.
- Backup preference: a dedicated git repo for `work/` (recommended default: an env var
  like `GITHUB_REPO_WORK`, commit & push as the last action of every run) or local-only
  (volume persistence, reconstruct-on-loss)?

Determines: `work/` inventory, seed templates embedded in ONBOARDING, the state
reconstruction step, persistence doc content, end-of-run persist step.

## 8. Configuration

- What differs between two deployments of this agent (target repo/project/board, names,
  markers, labels, feature toggles)? Each becomes a `work/CONFIG.md` key with: default,
  missing-key behavior, and whether it is **immutable once used** (anything woven into
  external dedup markers is).
- Which env vars override which keys (env var always wins)?

Determines: Runtime configuration section of CLAUDE.md, the ONBOARDING config dialog
(ask → validate → default, keep existing values on re-onboarding).

## 9. Cost envelope

- How often do runs fire and how many items will a busy day bring? Multiply: a
  10-minute heartbeat is ~144 runs/day — anything the agent does per run, it does 144×.
- What fraction of runs will find nothing? That fraction should cost ~zero (the
  pre-flight's `nothing_to_do` short-circuit).
- Agree on what stays deterministic (script) vs. judgment (agent). When the user asks for
  something expensive, propose the cheaper equivalent and let them choose.

Determines: cadences, pre-flight scope, how much batching the design needs.

## Wrap-up — the design brief

Summarize into a short brief and get a "yes": mission, name, unit of work + lifecycle,
integrations (read/write) with idempotency markers, run model + cadences, channels +
proactive opt-ins + trust exceptions, state files + backup choice, config keys, cost
notes. This brief feeds Phase 2.
