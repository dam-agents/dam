# Experimental features

Last verified: 2026-10-26

## Overview

**Experimental features** are per-user toggles for pre-release surfaces.
Every feature defaults **off**; a user opts in through a hidden "Experimental features" settings tab (revealed by five taps on the version string).
The tab also carries a button that resets the user's [onboarding progress](getting-started.md#in-the-browser).
The current features are advanced connection types, interactive artifacts, agent telemetry (a per-reply timeline in the conversation), [chat forms](chat-forms.md) (agents put forms and choices into their chat replies, and the chat tells them it can render them), and the processes panel (a chat-view section listing what runs in the agent, what keeps it awake and what finished, with each process's output, a Stop per process and a keep switch per background process, the agent's Login items with their controls, and a header indicator that replaces the background-task one; see [agent-processes](agent-processes.md)), custom avatars (an emoji or an uploaded image as an Agent's avatar; see [agent-avatars](agent-avatars.md#custom-avatars)), and Environments (sandboxes an agent creates for others to open; see [environments](environments.md)).
Graduating a feature to always-on is deletion: drop its id from the enum and its gates from the UI — stored rows for a dropped id are simply never read again (Knowledge Bases, the [starter kit](starter-kits.md) catalog, session costs, [agent avatars](agent-avatars.md) and addressed credential injection graduated this way).

An operator can take a feature out of users' hands: the chart's `features` value gives each feature a mode, `experimental` leaving the per-user switch, `on` or `off` deciding for every user whatever they stored.
A feature `features` does not name takes the chart's `featureDefault` mode, `experimental` unless set.
The chart names no feature itself, so an install that sets `featureDefault` to `off` keeps every feature off, including one a later release adds, until it names that feature.
A pinned feature's switch is hidden from the settings tab, and the api-server answers its flag from the mode, so every surface that reads flags — the UI and agent surfaces alike — sees the same answer.
Stored rows are kept, so returning a feature to `experimental` restores each user's own choice.

Flags are stored server-side, per user, in Postgres — not in the browser.
That is deliberate: feature surfaces are not necessarily UI-only.
A pre-release surface can include agent-facing pieces — MCP tools on the per-agent platform MCP server, registered per session from the owner's flags — and a browser-local flag could not reach that decision.
(Server-stored flags replaced earlier localStorage-based debug toggles for the same surfaces; users who had those set re-enable via the menu.)

## What a flag does — and does not — gate

A feature flag is **progressive disclosure, not authorization**.
It controls where a feature *appears*:

- **UI surfaces** — navigation destinations, settings tabs, panels.
  Most current features gate only these.

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
