# Features

Last verified: 2026-11-25

## Overview

A **feature** is a per-user toggle for a pre-release surface.
Every feature has a **level**, set in the contract beside its id.

An **experimental feature** is one any person may try.
The test is whether it is fine for a normal user to turn it on today.
Its switch is under Settings › Experimental features, a tab everyone sees, and the install gives it a mode.
The experimental features are custom avatars (an emoji or an uploaded image as an Agent's avatar; see [agent-avatars](agent-avatars.md#custom-avatars)) and the assistant (the ordinary Agent the platform makes for a person under its brand's assistant name; see [assistant](assistant.md)).

An **internal feature** is one the team is still trying out, and most of them will not stay as they are.
Its switch is on the Internal features page, which no navigation lists: only its address, `/settings/internal`, opens it.
The page is hidden, not locked, so whoever knows the address may switch an internal feature on for themselves, on any install.
The install has no say over an internal feature, which is what lets the team try one where real work happens.
The page also carries a button that resets the user's [onboarding progress](getting-started.md#in-the-browser).
The internal features are advanced connection types, the processes panel (a chat-view section listing what runs in the agent, what keeps it awake and what finished, with each process's output, a Stop per process and a keep switch per background process, the agent's Login items with their controls, and a header indicator that replaces the background-task one; see [agent-processes](agent-processes.md)), Environments and kept sub-agents (sandboxes an agent creates for others to open, and sub-agents it keeps after their result to enter, run more work in and continue; see [environments](environments.md) and [invocations](invocations.md#outcomes)), the Hermes harness (Nous Research's Hermes Agent offered beside the other harnesses an agent's image carries), the install's own Connection ([connection presets](connection-presets.md#platform-preset-this-install-itself)), which lets an Agent act as its owner, GitHub Enterprise hosts (a host picker in the connect form, of the offered hosts or one with the user's own app, and a move between offered hosts; see [github-connections](github-connections.md#github-enterprise-hosts)), network approvals in the chat (an Agent's waiting network approvals above the message box of its open conversation, which otherwise wait in the approvals list and the notifications; see [security-and-credentials](security-and-credentials.md#hitl-ext_authz)), one-time tasks in the schedule form (its Repeat / Once choice and the one-time task editor; agents, the CLI and the API create one-time tasks whatever the flag says, and without it the schedules list shows one as a row that can only be deleted; see [schedules](schedules.md#one-time-schedules)), tool approval for MCP connections (each Agent's own tool access on an MCP Connection, allow, ask or block per tool, which the owner sets only with the flag on and which a new grant starts safe in; the gate reads a stored access whatever the flag says, though with the flag off nothing shows it; see [connections](connections.md#connection)), and the assistant's security check (a weekly scheduled run that reports what in the person's setup goes against the security advisory; see [assistant](assistant.md#the-security-check)).

Every feature defaults **off**, except the assistant, which every person has on and can turn off.
A feature moves from internal to experimental by changing its level, and each user's stored choice stays.
Graduating a feature to always-on is deletion: drop its id from the enum and its gates from the UI — stored rows for a dropped id are simply never read again (Knowledge Bases, the [starter kit](starter-kits.md) catalog, session costs, [agent avatars](agent-avatars.md), addressed credential injection, [interactive artifacts](artifact-library.md#interactive-pages), [agent telemetry](agent-telemetry.md) and [chat forms](chat-forms.md) graduated this way).
A graduation may also add a migration that deletes the dropped id's rows, so no stored choice outlives the feature; interactive artifacts, agent telemetry and chat forms did.

An operator can take an experimental feature out of users' hands: the chart's `features` value gives each one a mode, `user` leaving the per-user switch, `on` or `off` deciding for every user whatever they stored.
An experimental feature `features` does not name takes the chart's `featureDefault` mode, `user` unless set.
The chart names no feature itself, so an install that sets `featureDefault` to `off` keeps every experimental feature off, including one a later release adds, until it names that feature.
`experimental` is the old name of the `user` mode, and values that still say it mean the same.
A pinned feature's switch is hidden from the settings tab, the tab itself hides while it has no switch to offer, and the api-server answers the flag from the mode, so every surface that reads flags — the UI and agent surfaces alike — sees the same answer.
Stored rows are kept, so returning a feature to `user` restores each user's own choice.
Values that name an internal feature fail the install, at the chart's render and again when the api-server starts, so an operator never trusts a pin that does nothing.
An internal feature always reads as the `user` mode.
One feature is **on by default** — the [assistant](assistant.md) — so in `user` a person who has stored nothing has it on, and their switch turns it off; every other feature is off until switched on.

Flags are stored server-side, per user, in Postgres — not in the browser.
That is deliberate: feature surfaces are not necessarily UI-only.
A pre-release surface can include agent-facing pieces — MCP tools on the per-agent platform MCP server, registered per session from the owner's flags — and a browser-local flag could not reach that decision.
(Server-stored flags replaced earlier localStorage-based debug toggles for the same surfaces; users who had those set re-enable via the menu.)

## What a flag does — and does not — gate

A feature flag is **progressive disclosure, not authorization**.
It controls where a feature *appears*:

- **UI surfaces** — navigation destinations, settings tabs, panels.
  Most current features gate only these.
  The Hermes harness gates the list of harnesses an agent's harness-config status offers and the harnesses of the owner catalog its Settings pickers read, so the api-server leaves Hermes out of both for an owner with the flag off.
  A change or a session that names Hermes still goes through.

- **Agent surface** — whether the feature's MCP tools are registered into an agent's MCP session, decided at session creation.
  A toggle then reaches live agents when their session rolls over (bounded by the session TTL) and new sessions immediately.
  Environments carries the Environment tools and the kept sub-agent ones: `spawn_subagent`'s `keep`, `keepForMs`, `idleTimeout` and `egress` and its clean slate, and `run_subagent`, `wake_subagent`, `update_subagent` and `update_subagent_egress`; the driver SDK's routes for them stay open, as every endpoint does.
  The endpoint creates a session per request, so the owner's flags are read on every request.

- **A create the platform makes for the person** — switching the assistant's flag on gives that person their assistant, and an install that pins the flag `on` gives it at the first request instead ([assistant](assistant.md#provisioning)).
  The flag decides who is offered one; it protects nothing afterwards, since the Agent it makes is the person's own.
  The security check's flag works the same way for a Schedule: switching it on gives the person's assistant its weekly check, and switching it off deletes that Schedule ([assistant](assistant.md#the-security-check)).
  How much a check does is not a flag: it is a level the person chooses in the assistant's own settings, so it stays when the feature stops being an experiment.

- **A rollup inside a shared read** — where a feature adds one section to a response every caller already receives, the flag decides whether that section is computed.
  The gate is a cost decision, not an access one: the section rides in a procedure nobody can opt out of, so leaving it ungated would charge every user its backing queries to render nothing.
  Off, the field comes back empty; the procedure itself stays open.
  No current feature gates a rollup (the spend-by-session-kind rollup in [metrics](metrics.md) did before it graduated).

What none of these do is **gate an endpoint**: the feature's tRPC procedures remain callable by the authenticated owner regardless of the flag, and a flagged-off client that calls one gets a valid, owner-scoped answer rather than a refusal.
Every endpoint is owner-scoped and safe on its own terms — a flag decides what is shown and what is computed, it is not a security boundary.
Two internal features refuse with the flag off, for that person alone; no install mode stands behind the refusal.
`damConnection` refuses its own create and its grants, because they make the Connection that acts as the owner and hand it to an Agent.
`mcp-tool-approval` refuses a tool mode that asks and any change of one Agent's tool access, and it also decides whether a new grant stores a tool access of its own and whether a client is shown one ([connections](connections.md#connection)).
Anything else that must actually be denied is enforced by auth and owner scoping, never by a flag check.

## Semantics

- Only explicit toggles are stored; unknown or removed feature ids in storage are ignored rather than surfaced, so retiring a feature needs no data migration.
- Flags are read through an owner-scoped service, same composition pattern as every other per-user module.

## Where the code lives

- Contract (feature ids, levels, modes, tRPC router): [`packages/api-server-api/src/modules/features/`](../../packages/api-server-api/src/modules/features/)
- Implementation (service, repository): [`packages/api-server/src/modules/features/`](../../packages/api-server/src/modules/features/)
- The two settings pages: [`packages/ui/src/modules/features/`](../../packages/ui/src/modules/features/)
