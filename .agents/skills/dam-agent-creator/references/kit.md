# The kit (`kit.yaml`)

Read in Phase 0, before the interview — the kit decides what the operator never has to do
by hand, so it changes what Phase 2 proposes and what ONBOARDING still owns.

A **Starter Kit** is how the platform creates an agent from a definition: the connections,
schedules, channels, size and seed a job needs, declared in a `kit.yaml` the platform
reads out of git. For a definition repository like the ones this skill generates, **the
definition repository *is* the kit** — `kit.yaml` sits at the root beside `CLAUDE.md`, so
a change to the definition and the change to the kit describing it are one commit.

Generate one for every agent. Without it the operator wires the agent up by hand from
README and pastes the ONBOARDING.md link; with it they pick the kit from the catalog.

## What the kit does and what ONBOARDING still owns

| Step | Without a kit | With a kit |
| --- | --- | --- |
| Definition checked out at `$HOME` | ONBOARDING derives the repo from the runbook URL, then init + fetch + reset | the platform seeds it at the commit the kit was read at, before the first turn |
| Required connections | the operator reads README and grants them | `connections:` — apply refuses before anything is created when one is missing |
| Fixed env vars | the operator sets them on the agent | `env:` |
| Schedules | ONBOARDING creates each one over MCP | `schedules:` — apply creates them; suggested ones arrive disabled |
| Size, hibernation | install defaults | `resources:`, `hibernationTimeoutMin:` |
| First turn | the operator pastes the ONBOARDING.md link | the platform composes the briefing and opens the session itself |
| Idle scheduled fire | a turn wakes, runs the pre-flight, reads `nothing_to_do`, ends | the `precheck` declines and **no model is woken at all** |

What stays ONBOARDING's, unchanged: everything the operator alone can answer. The config
dialog, the roster, the state seeds, state reconstruction, the sentinel, and the
verification pass. A kit declares what the *platform* can set up; `ONBOARDING.md` is still
the runbook for what only a conversation can settle.

## The shape a generated definition uses

```yaml
schemaVersion: v1
id: {{AGENT_NAME}}
name: <display name>
description: <one paragraph — what it does, on what unit of work>
category: software          # knowledge | software | productivity | research
seed:
  self: true                # this repository, at the commit the kit was read at
  into: home                # the definition IS $HOME — this skill's shape
```

- **`seed.self: true`** — never repeat the repository's own URL. A seed names exactly one
  of `self` or `url`, and `self` is what pins the definition to the very commit the kit was
  resolved at, so a kit can never describe a definition it was not read with.
- **`seed.into: home`** — the definition repo lives at `$HOME` with `work/` git-ignored
  beside it. The platform's home seed is init + fetch + hard-reset of tracked paths, never
  a clone, so nothing the platform or harness put in `$HOME` is removed; it also registers
  `$HOME` as a git `safe.directory`, which every later `git` in the pod needs.
- **`id`** is the agent name, and `{{AGENT_NAME}}` must match it — the sentinel, the
  schedule prefix and the kit id all name the same agent.

## Never declare `onboarding`

Leave the field out. The consequence is not cosmetic:

- **Absent** — the platform composes the briefing from the live agent state (the checkout
  and its commit, each connection and whether it is *actually* connected right now, the
  real schedules and which are disabled, the bound channel) and ends it with "follow
  `ONBOARDING.md`". That is exactly the entry this skill's runbook is written for.
- **`onboarding: { command: … }`** — a bare harness command is a mechanical trigger with
  nothing to read, so the platform stamps the agent **onboarded at create**. That drops the
  onboarding gate, the progress tools, and the hold on schedules — a generated agent needs
  all three, and its first act is to ask the operator for values only they have.
- **`onboarding: false`** — no first session at all. Only for a workload that takes its
  brief from the user's first prompt; never for an agent with a config dialog.

## The onboarding gate

An agent created from a kit is **not fully configured** until it says so, and the scheduler
**holds every schedule on it** until then — the occurrence is skipped, the next one is
armed as normal, and the schedule records `held: onboarding not complete`. So a kit-created
agent cannot half-configure itself into doing the wrong work on a cadence.

Three MCP tools exist only while onboarding is pending, and the generated `ONBOARDING.md`
must use them:

- `set_onboarding_checklist` — opened at the start of the runbook with one step per value
  **only the operator can supply**, decision only they can make, or action only they can
  take. Never the agent's own work. Callable again to add, rename or drop steps.
- `complete_onboarding_step` — ticked as each answer arrives.
- `mark_onboarding_complete` — called once the configuration is genuinely in place. This
  is what releases the schedules; it is idempotent.

The sentinel stays. It guards the runbook against re-running on the same volume; the stamp
is what the *platform* gates schedules on. They answer different questions, so a generated
ONBOARDING writes both.

## Connections

```yaml
connections:
  - accepts: [github]       # a family — satisfied by OAuth, PAT or App
    required: true
    note: Reads pull requests and posts review comments.
  - accepts: [slack]
    required: false
    note: Only needed when proactive nudges are enabled.
```

- `accepts` takes connection **families** (`github`, `github-enterprise`, `slack`, …) or a
  named Connection Template. Prefer the family — it lets any auth method satisfy the kit;
  name a template only when the design must insist on one method.
- `required: true` is checked **before create** and refuses with nothing to clean up. Mark
  required only what the agent cannot start without; anything behind an opt-in config key
  is `required: false`.
- The provider is never a connection requirement — it goes in `providers:`.

## Schedules, and the precheck

```yaml
schedules:
  - name: {{AGENT_NAME}}-work-10m
    cron: "*/10 * * * *"
    task: >-
      Work heartbeat. …
    sessionMode: fresh
    precheck: bash "$HOME/scripts/precheck.sh" work
  - name: {{AGENT_NAME}}-audit-weekly
    cron: "0 6 * * 1"
    task: >-
      Weekly self-audit. …
    sessionMode: fresh
    enabled: false          # suggested — the operator turns it on
```

- Names carry the agent prefix, exactly as ONBOARDING's check-then-create expects — the two
  must agree or the runbook creates a second copy of every schedule.
- `task` is the same text ONBOARDING would have registered; it stays the one source of
  truth for the entry command (`references/preflight.md` → Schedule task text).
- `enabled: false` makes a schedule **suggested** — created off, the operator turns it on.
- `precheck` is the kit's own declaration of the check the repository carries
  (`references/preflight.md` → **The Precheck**). Only a kit that seeds its definition may
  declare one: the command has to exist in the checkout by the time the first fire lands.
- The apply form shows each precheck with its schedule, to keep, replace or drop.

## The rest of the fields

Declare only what the design actually needs; every one of these is optional.

| Field | When |
| --- | --- |
| `tagline`, `icon`, `docsUrl` | catalog presentation — a one-line hook, an icon name, a link to README |
| `harnesses: [claude-code, …]` | the definition depends on a harness family's conventions (hooks under `scripts/harness/<harness>/`, a command spelling) |
| `providers: [...]` | the workload needs specific provider presets |
| `resources: {cpu, memory, storage, note}` | the workload needs more than the install default; `note` says why. Limits only — never requests. `storage` is fixed at create |
| `hibernationTimeoutMin` | a heartbeat finer than the install's idle timeout, so the agent is not paid for round-trip wake-ups |
| `env: [{name, value}]` | a **fixed** value every deployment shares. Instance values belong in the config dialog, never here |
| `bundledSkills: {path}` | the design bundles a skill — a scan root (`.agents/skills`); declared for display, the platform installs nothing |
| `skills: [{source, name}]` | a skill from another repository, installed at apply from a connected Skill Source |
| `channels: [{type, note}]` | the agent listens on Slack or Telegram; suggested only, never blocks apply |
| `install: {command}` | a bootstrap that must run before the first session. Rarely needed here — ONBOARDING is this skill's bootstrap, and it runs as a conversation |
| `knowledgeBase: {shareRoots}` | the agent publishes a knowledge base from named workspace paths |
| `image: {ref, harness, providers}` | never, for a generated definition — it runs on a harness the operator picks |

## Constraints

- **A `self: true` kit's repository must be public.** Catalogs are read anonymously over
  the public raw-file endpoint. A private definition cannot be its own kit: put the
  `kit.yaml` in the catalog repository instead and point `seed.url` at the private repo,
  which clones through the granted GitHub connection.
- **`self` means the repository the kit was read from — literally.** So the catalog entry
  must name the definition by its own `url`. A kit listed as a `path:` inside the catalog
  repository would seed *the catalog repository*, and one in the chart's built-in catalog
  has no repository at all: the refresh rejects it outright with *"the kit's seed says
  `self` but the kit was not read from a repository"*, and it never reaches the listing.
- **A version is written in one place and one way** — a plain `url` plus an optional `ref`.
  A URL carrying a `#ref` fragment or a `/tree/<ref>/…` path is refused outright, never
  read at the default branch.
- **The platform never reads configuration back out of the agent's repository.** The kit is
  a catalog input read before create; an agent committing to its own definition afterwards
  changes nothing the platform enforces.
- **A kit that fails schema validation is dropped from the listing** with a logged reason.
  Validate before publishing (`scripts/validate-definition.sh` covers the shape).
- Apply is **create-only**. Editing the kit never touches agents already created from it.

## Publishing the kit

The kit reaches an install through a **catalog** — a public repository holding a
`catalog.yaml`. Adding a definition kit is one entry pointing at its repository:

```yaml
kits:
  - url: https://github.com/<org>/{{AGENT_NAME}}
  # - ref: v1.0.0      # optional; unpinned means the refresh job follows the default branch
```

The refresh job re-reads every catalog periodically and resolves each entry to a commit, so
an entry added there reaches the install without a redeploy — and an unpinned catalog still
yields exact, immutable kits. Which catalog to use is the operator's call; the install's
`starterKits.catalogs` names them (`curated` by default).
