# 03 — Skip the wait on the startup screen

**Part of:** Always-on — see [README](./README.md)

## Context

While a user waits for an agent to start, the wait screen offers **Skip the wait — keep
always-on**. Choosing it sets the agent to Always on, so the wait they are sitting through is
their last.

## Implementation plan

1. `packages/ui/src/modules/agents/components/agent-unavailable-overlay.tsx`: in the spinner
   branch (states `starting` and `preparing_workspace`), below the `StartupTip`, render an
   outline button `Skip the wait — keep always-on` when `agent.hibernationTimeoutMin !== 0`.
2. Clicking it calls the existing agents update mutation (the one
   `use-sandbox-settings-save.ts` uses) with `{ id: agent.id, hibernationTimeoutMin: 0 }`,
   disabled while pending. On success the cache-refreshed `AgentView` carries `0`, so the
   button disappears on its own; no bespoke confirmation state.
3. The button is a one-click setting change on an agent the user deliberately opened —
   no confirm dialog (matches the Figma frame).

Apply the `/react-ui-engineering` skill.

## Acceptance criteria

- [ ] The button shows only while starting/preparing and only for agents not already always-on.
- [ ] Clicking sets `hibernationTimeoutMin: 0` and the button disappears; Agent Setup then shows
      Always on selected.
- [ ] The overlay for hibernated/error/over-budget states is unchanged.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

On the dev server start a hibernated non-always-on agent and open its chat during startup: the
button appears; click it; when the agent is up, its Agent Setup shows Always on.
