# The kit (`kit.yaml`)

Read in Phase 0, before the interview: the kit decides what the operator never does by
hand, which changes what Phase 2 proposes and what ONBOARDING still owns.

A **Starter Kit** is how the platform creates an agent: the connections, schedules,
channels, size and seed a job needs, declared in a `kit.yaml` read from git. Here **the
definition repository *is* the kit**: `kit.yaml` sits at the root beside `CLAUDE.md`, so a
definition change and the matching kit change are one commit.

Generate one for every agent. Without it the operator wires the agent by hand from README
and pastes the ONBOARDING.md link; with it they pick the kit from the catalog.

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

ONBOARDING still owns everything only the operator can answer: config dialog, roster,
state seeds, state reconstruction, sentinel, verification pass. The kit declares what the
*platform* can set up; `ONBOARDING.md` settles what only a conversation can.

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

- **`seed.self: true`**: never repeat the repo's own URL. A seed names exactly one of
  `self` or `url`; `self` pins the definition to the commit the kit was resolved at, so a
  kit never describes a definition it wasn't read with.
- **`seed.into: home`**: the repo lives at `$HOME` with `work/` git-ignored beside it. The
  home seed is init + fetch + hard-reset of tracked paths, never a clone, so nothing the
  platform or harness put in `$HOME` is removed; it also registers `$HOME` as a git
  `safe.directory`, which every later `git` in the pod needs.
- **`id`** is the agent name and must match `{{AGENT_NAME}}`: sentinel, schedule prefix
  and kit id name the same agent.

## Never declare `onboarding`

Leave the field out; the consequence is not cosmetic:

- **Absent**: the platform composes the briefing from live agent state (checkout and
  commit, each connection and whether it is *actually* connected now, the real schedules
  and which are disabled, the bound channel) and ends with "follow `ONBOARDING.md`":
  exactly the entry this runbook is written for.
- **`onboarding: { command: … }`**: a bare harness command is a mechanical trigger, so
  the platform stamps the agent **onboarded at create**, dropping the onboarding gate, the
  progress tools and the schedule hold. A generated agent needs all three; its first act
  is asking the operator for values only they have.
- **`onboarding: false`**: no first session. Only for a workload briefed by the user's
  first prompt; never for an agent with a config dialog.

## The onboarding gate

A kit-created agent is **not fully configured** until it says so, and the scheduler **holds
every schedule** until then: the occurrence is skipped, the next armed as normal, and the
schedule records `held: onboarding not complete`. It cannot half-configure itself into
doing the wrong work on a cadence.

Three MCP tools exist only while onboarding is pending; the generated `ONBOARDING.md` must
use them:

- `set_onboarding_checklist`: at the start, one step per value **only the operator can
  supply**, decision only they can make, or action only they can take; never the agent's
  own work. Callable again to add, rename or drop steps.
- `complete_onboarding_step`: ticked as each answer arrives.
- `mark_onboarding_complete`: once the configuration is genuinely in place; releases the
  schedules; idempotent.

The sentinel stays: it guards the runbook against re-running on the same volume, while the
stamp is what the *platform* gates schedules on. Different questions, so ONBOARDING writes
both.

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
  named Connection Template. Prefer the family (any auth method satisfies it); name a
  template only when the design must insist on one method.
- `required: true` is checked **before create** and refuses with nothing to clean up. Only
  what the agent cannot start without; anything behind an opt-in config key is
  `required: false`.
- The provider is never a connection requirement; it goes in `providers:`.

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
    cron: "0 6 * * 5"
    task: >-
      Weekly self-audit. …
    sessionMode: fresh
    enabled: false          # suggested — the operator turns it on
```

- Names carry the agent prefix exactly as ONBOARDING's check-then-create expects, or the
  runbook creates a second copy of every schedule.
- `task` is the text ONBOARDING would register: the one source of truth for the entry
  command (`references/preflight.md` → Schedule task text).
- `enabled: false` makes a schedule **suggested**: created off, the operator turns it on.
- `precheck` declares the check the repo carries (`references/preflight.md` → **The
  Precheck**). Only a kit that seeds its definition may declare one: the command must exist
  in the checkout by the first fire.
- The apply form shows each precheck with its schedule, to keep, replace or drop.

## The rest of the fields

All optional; declare only what the design needs.

| Field | When |
| --- | --- |
| `tagline`, `icon`, `docsUrl` | catalog presentation — a one-line hook, an icon name, a link to README |
| `harnesses: [claude-code, …]` | the definition depends on a harness family's conventions (hooks under `scripts/harness/<harness>/`, a command spelling) |
| `providers: [...]` | the workload needs specific provider presets |
| `resources: {cpu, memory, storage, note}` | the workload needs more than the install default; `note` says why. Limits only — never requests. `storage` is fixed at create |
| `egressRules: [{host, verdict, …}]` | hosts the job always needs beyond the preset, or must never reach (`verdict: deny`); same shape as a rule written by hand |
| `egressPreset: none \| trusted \| all` | the agent's web access at create. Omit for the platform default (`trusted`); `none` for a job that needs no network beyond its connections, `all` only when the job browses arbitrary sites |
| `hibernationTimeoutMin` | a heartbeat finer than the install's idle timeout, so the agent is not paid for round-trip wake-ups |
| `requireConnectionAddress: true` | the agent runs tools (Docker containers, nested agents) that call the same services with their own credentials or none, so its gateway must inject only requests that name a connection and leave theirs alone |
| `env: [{name, value}]` | a **fixed** value every deployment shares. Instance values belong in the config dialog, never here |
| `bundledSkills: {path}` | the design bundles a skill — a scan root (`.agents/skills`); declared for display, the platform installs nothing |
| `skills: [{source, name}]` | a skill from another repository, installed at apply from a connected Skill Source |
| `channels: [{type, note}]` | the agent listens on Slack or Telegram; suggested only, never blocks apply |
| `install: {command}` | a bootstrap that must run before the first session. Rarely needed here — ONBOARDING is this skill's bootstrap, and it runs as a conversation |
| `knowledgeBase: {shareRoots}` | the agent publishes a knowledge base from named workspace paths |
| `image: {ref, harness, providers}` | never, for a generated definition — it runs on a harness the operator picks |

## Constraints

- **A `self: true` kit's repository must be public**: catalogs are read anonymously over
  the public raw-file endpoint. A private definition can't be its own kit: put `kit.yaml`
  in the catalog repo and point `seed.url` at the private repo, which clones through the
  granted GitHub connection.
- **`self` literally means the repository the kit was read from**, so the catalog entry
  must name the definition by its own `url`. A kit listed as a `path:` in the catalog repo
  would seed *the catalog repo*, and one in the chart's built-in catalog has no repository:
  the refresh rejects it with *"the kit's seed says `self` but the kit was not read from a
  repository"*, and it never reaches the listing.
- **A version is written one way**: a plain `url` plus optional `ref`. A URL with a `#ref`
  fragment or `/tree/<ref>/…` path is refused, never read at the default branch.
- **The platform never reads configuration back from the agent's repo.** The kit is read
  before create; later commits to the definition change nothing the platform enforces.
- **A kit failing schema validation is dropped from the listing** with a logged reason.
  Validate before publishing (`scripts/validate-definition.sh` covers the shape).
- Apply is **create-only**: editing the kit never touches agents already created.

## Publishing the kit

A kit reaches an install through a **catalog**: a public repo holding `catalog.yaml`. Adding
a definition kit is one entry:

```yaml
kits:
  - url: https://github.com/<org>/{{AGENT_NAME}}
  # - ref: v1.0.0      # optional; unpinned means the refresh job follows the default branch
```

The refresh job periodically re-reads every catalog and resolves each entry to a commit, so
a new entry reaches the install without a redeploy, and an unpinned catalog still yields
exact, immutable kits. The operator picks the catalog; the install's
`starterKits.catalogs` names them (`curated` by default).
