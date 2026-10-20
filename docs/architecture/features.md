# Experimental features

Last verified: 2026-10-20

## Overview

**Experimental features** are per-user toggles for pre-release surfaces.
Every feature defaults **off**; a user opts in through a hidden "Experimental features" settings tab (revealed by five taps on the version string).
The tab also carries a button that resets the user's [onboarding progress](getting-started.md#in-the-browser).
The current features are advanced connection types, interactive artifacts, agent telemetry (a per-reply timeline in the conversation), [chat forms](chat-forms.md) (agents put forms and choices into their chat replies, and the chat tells them it can render them), and the processes panel (a chat-view section listing what runs in the agent, what keeps it awake and what finished, with each process's output, a Stop per process and a keep switch per background process, and a header indicator that replaces the background-task one; see [agent-processes](agent-processes.md)), custom avatars (an emoji or an uploaded image as an Agent's avatar; see [agent-avatars](agent-avatars.md#custom-avatars)), the built-in LLM provider (the operator's self-hosted model server as a provider the user does not connect; see [connections](connections.md#built-in-preset-platform-llm)), and the new layout (a different app shell, Home and side rails, and in an Agent's chat the side panel with its icon bar; see [home-feed](home-feed.md#the-new-layout)).
Graduating a feature to always-on is deletion: drop its id from the enum and its gates from the UI — stored rows for a dropped id are simply never read again (Knowledge Bases, the [starter kit](starter-kits.md) catalog, session costs, [agent avatars](agent-avatars.md) and addressed credential injection graduated this way).

An operator can take a feature out of users' hands: the chart's `features` value gives each feature a mode, `experimental` leaving the per-user switch, `on` or `off` deciding for every user whatever they stored.
A feature `features` does not name takes the chart's `featureDefault` mode, `experimental` unless set.
The chart names no feature itself, so an install that sets `featureDefault` to `off` keeps every feature off, including one a later release adds, until it names that feature.
A pinned feature's switch is hidden from the settings tab, and the api-server answers its flag from the mode, so every surface that reads flags — the UI and agent surfaces alike — sees the same answer.
Stored rows are kept, so returning a feature to `experimental` restores each user's own choice.

A per-user flag says what a user wants to see; it cannot say what the install can do.
The module therefore also answers one install-wide question — whether this deployment supports microVMs — read from the chart's own `virtualization.enabled` rather than from any stored row ([vm-runner](vm-runner.md)).
That answer is what the runtime of a new agent follows, and it is not a feature: the new sandbox runtime graduated, so no switch decides it and no settings row hides it.
**An install that can run microVMs creates every new agent as one**, whichever path makes it: the api-server applies this in the one create every path ends in, rather than trusting each caller, so a kit that declares nothing, a [sub-agent](invocations.md) spawn, the CLI and the API land where the forms do.
A kit that declares `backend: vm` ([starter-kits](starter-kits.md#kit-backend)) is the one declaration that can refuse instead: on an install without virtualization the kit is hidden and the create refuses it, since there is no machine to put the agent on.
No kit can declare that it needs a container, so the install's answer never meets a kit it would have to refuse.
**A container agent cannot be created there at all**: a create that asks for one is refused with a message naming the runtime the install does make, rather than quietly made a machine instead, so nothing new lands on the legacy path.
**An install without virtualization keeps creating containers**, and is the only place a container Agent is created at all.
That is an install whose host cannot virtualize — an Intel Mac, or a Linux host whose k3s VM gets no hypervisor from the install — and an install that turned virtualization off in its values or with `--set`.
A local install is one of these only where it cannot virtualize or was asked not to.
`cluster:install` turns virtualization on by default on an Apple silicon Mac, on one runner on the Mac's own hypervisor ([vm-host-runner](vm-host-runner.md)), and in a sandbox that can open `/dev/kvm`, unless the values or a flag decide otherwise; under CI it stays off unless asked for.

### Install preflight

The install-wide answer is the chart's value alone, and turning it on asks an operator to get several things right at once: a device plugin, the runner's identity, its memory limit, its egress ranges, the image budget.
Each one gone wrong would otherwise surface only as a vm Agent that never becomes ready.
So the chart refuses the values the controller cannot use, and the [controller](platform-topology.md#controller) checks the install against the cluster at startup and on a periodic pass: that a schedulable node in the [VM runners'](platform-topology.md#vm-runner) placement advertises the device resources, that the runner ServiceAccount exists, and that the values it hands each runner are usable.
A **problem** is logged and named on every vm Agent whose runner is not ready.

What the check cannot see is said as a **warning**, logged only and never on an Agent — so silence on an Agent is not a pass:

- **Nodes it may not list.** Reading nodes needs a cluster-wide read-only grant the chart adds with virtualization, which also feeds the node capacity in the operators' [pool metrics](observability.md#alerts); an install without it gets a log line instead of the device check, and pool metrics without node capacity.
- **Egress that reaches the cluster.** The runner's egress ranges match in-cluster addresses too.
  No portable API names the pod range, so the exceptions are never defaulted from the cluster; the controller instead checks the ones configured against an address it knows sits in each range — the API server's Service address and its own pod address.
  Reaching one is only a warning, because an install may leave a range open on purpose.
- **Taints.** Placement is checked against the node selector alone; the scheduler's own message on the runner pod says when a toleration is missing.

The api-server does not read this result: a failed preflight does not withdraw the install-wide answer.

Flags are stored server-side, per user, in Postgres — not in the browser.
That is deliberate: feature surfaces are not necessarily UI-only.
A pre-release surface can include agent-facing pieces — MCP tools on the per-agent platform MCP server, registered per session from the owner's flags — and a browser-local flag could not reach that decision.
(Server-stored flags replaced earlier localStorage-based debug toggles for the same surfaces; users who had those set re-enable via the menu.)

## What a flag does — and does not — gate

A feature flag is **progressive disclosure, not authorization**.
It controls where a feature *appears*:

- **UI surfaces** — navigation destinations, settings tabs, panels.
  Most current features gate only these.

- **A Connection the flag owns** — the built-in LLM provider's flag decides whether the user holds its provider Connection: the connections module creates it when the flag turns on, or on the user's next listing of their Connections when the install's mode is `on`, and removes it when the flag turns off.
  The flag is read rather than taken from the change event, so a stored choice the install's mode overrides creates nothing.
  The feature is `off` on an install that names no model server, whatever the chart's modes say.

- **Agent surface** — whether the feature's MCP tools are registered into an agent's MCP session, decided at session creation.
  A toggle then reaches live agents when their session rolls over (bounded by the session TTL) and new sessions immediately.
  [Chat forms](chat-forms.md) carries one: the `check_chat_form` tool.
  The endpoint creates a session per request, so the owner's flags are read on every request.

- **A rollup inside a shared read** — where a feature adds one section to a response every caller already receives, the flag decides whether that section is computed.
  The gate is a cost decision, not an access one: the section rides in a procedure nobody can opt out of, so leaving it ungated would charge every user its backing queries to render nothing.
  Off, the field comes back empty; the procedure itself stays open.
  No current feature gates a rollup (the spend-by-session-kind rollup in [metrics](metrics.md) did before it graduated).

What none of these do is **gate an endpoint**: the feature's tRPC procedures remain callable by the authenticated owner regardless of the flag, and a flagged-off client that calls one gets a valid, owner-scoped answer rather than a refusal.
Every endpoint is owner-scoped and safe on its own terms — a flag decides what is shown and what is computed, it is not a security boundary.
Anything that must actually be denied is enforced by auth and owner scoping, never by a flag check.

## Semantics

- Only explicit toggles are stored; unknown or removed feature ids in storage are ignored rather than surfaced, so retiring a feature needs no data migration.
- Flags are read through an owner-scoped service, same composition pattern as every other per-user module.

## Where the code lives

- Contract (feature ids, tRPC router): [`packages/api-server-api/src/modules/features/`](../../packages/api-server-api/src/modules/features/)
- Implementation (service, repository): [`packages/api-server/src/modules/features/`](../../packages/api-server/src/modules/features/)
- Hidden settings tab: [`packages/ui/src/modules/settings/`](../../packages/ui/src/modules/settings/)
