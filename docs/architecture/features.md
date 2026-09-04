# Experimental features

Last verified: 2026-09-03

## Overview

**Experimental features** are per-user toggles for pre-release surfaces. Every
feature defaults **off**; a user opts in through a hidden "Experimental
features" settings tab (revealed by five taps on the version string). The
current feature is advanced connection types. Graduating a feature to
always-on is deletion: drop its id from the enum and its gates from the UI —
stored rows for a dropped id are simply never read again (Experiments and
Knowledge Bases graduated this way).

Flags are stored server-side, per user, in Postgres — not in the browser.
That is deliberate: feature surfaces are not necessarily UI-only. A
pre-release surface can include agent-facing pieces — MCP tools on the
per-agent platform MCP server, registered per session from the owner's flags
— and a browser-local flag could not reach that decision. (Server-stored
flags replaced earlier localStorage-based debug toggles for the same
surfaces; users who had those set re-enable via the menu.)

## What a flag does — and does not — gate

A feature flag is **progressive disclosure, not authorization**. It controls
where a feature *appears*:

- **UI surfaces** — navigation destinations, settings tabs, panels. All
  current features gate only these.
- **Agent surface** — whether the feature's MCP tools are registered into an
  agent's MCP session, decided at session creation. A toggle then reaches
  live agents when their session rolls over (bounded by the session TTL) and
  new sessions immediately. No current feature carries an agent surface (the
  artifact library did before its promotion to a standard surface); the
  session-creation check is reintroduced with the next feature that needs
  it.

- **A rollup inside a shared read** — where a feature adds one section to a
  response every caller already receives, the flag decides whether that
  section is computed. The gate is a cost decision, not an access one: the
  section rides in a procedure nobody can opt out of, so leaving it ungated
  would charge every user its backing queries to render nothing. Off, the
  field comes back empty; the procedure itself stays open. The spend-by-
  session-kind rollup in [metrics](metrics.md) is the first of these.

What none of these do is **gate an endpoint**: the feature's tRPC procedures
remain callable by the authenticated owner regardless of the flag, and a
flagged-off client that calls one gets a valid, owner-scoped answer rather
than a refusal. Every endpoint is owner-scoped and safe on its own terms —
a flag decides what is shown and what is computed, it is not a security
boundary. Anything that must actually be denied is enforced by auth and
owner scoping, never by a flag check.

## Semantics

- Only explicit toggles are stored; unknown or removed feature ids in storage
  are ignored rather than surfaced, so retiring a feature needs no data
  migration.
- Flags are read through an owner-scoped service, same composition pattern as
  every other per-user module.

## Where the code lives

- Contract (feature ids, tRPC router): [`packages/api-server-api/src/modules/features/`](../../packages/api-server-api/src/modules/features/)
- Implementation (service, repository): [`packages/api-server/src/modules/features/`](../../packages/api-server/src/modules/features/)
- Hidden settings tab: [`packages/ui/src/modules/settings/`](../../packages/ui/src/modules/settings/)
