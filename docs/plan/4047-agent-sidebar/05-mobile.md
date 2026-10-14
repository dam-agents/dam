# 05 — Mobile navigation

**Depends on:** 01-sidebar-with-agents, 02-agent-sessions, 03-activity
**Part of:** Global sidebar with agents and activity — see [README](./README.md)

## Context

Optional: done if time allows, else split into its own issue.
On mobile the rail is a bottom bar today, with no agents or activity.

## Implementation plan

1. Design first with `/frontend-design:frontend-design`: how Agents and Activity reach a phone (for example a drawer opened from the bottom bar), shown to the user in an artifact for approval.
2. Build the approved design with `/react-ui-engineering`, reusing the sections from 01–03.

## Acceptance criteria

- [ ] The user approved the design.
- [ ] At phone width, a user opens an agent and a recent session in two taps.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

In a 390px-wide browser window: open the navigation, open an agent, open a session from Activity.
