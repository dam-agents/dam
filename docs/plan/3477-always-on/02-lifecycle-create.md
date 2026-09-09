# 02 — Lifecycle in the create flow

**Depends on:** 01-lifecycle-configure
**Part of:** Always-on — see [README](./README.md)

## Context

The coding-agent creation flow gains the same Lifecycle choice, so a user setting up background
work meets Always on where it matters. Default: Hibernate when idle, 60 minutes.

## Implementation plan

1. `packages/ui/src/modules/agents/lib/create-agent-input.ts`: add
   `hibernationTimeoutMin: number` to `CodingAgentSetupDraft` and pass it through
   `buildCodingAgentSetupInput` (the create tRPC input already accepts it — the api-server maps
   it via `minutesToDuration`). Always send the displayed value (README convention).
2. `packages/ui/src/modules/agents/views/coding-agent-setup-view.tsx`: initialize the draft
   with `hibernationTimeoutMin: 60`; render a `LIFECYCLE` section (same `SectionLabel` styling
   as the neighboring sections, placed after connections, per the Figma frame) containing
   `LifecycleField` bound to the draft.
3. Reserve line size source: the selected template's `size`
   (`TemplateView.size`, `packages/ui/src/types.ts`); with a custom image or a template without
   size, `LifecycleField` falls back to its generic wording.
4. `CreateAgentInline` (Slack/Telegram bind) stays untouched.

Apply the `/react-ui-engineering` skill.

## Acceptance criteria

- [ ] The create page shows the Lifecycle section defaulting to Hibernate when idle, 60.
- [ ] Creating with Always on yields an agent whose `hibernationTimeoutMin` is 0; creating with
      the default yields 60.
- [ ] Template switch updates the reserve line's numbers.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

On the dev server create one agent with Always on and one with the default; open each agent's
Agent Setup and confirm the selection round-trips (Always on / Hibernate 60).
