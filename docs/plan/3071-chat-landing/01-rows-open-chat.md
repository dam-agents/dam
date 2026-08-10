# 01 — Sandbox rows open chat and start a sleeping sandbox

**Part of:** one-click chat from the sandbox list — see [README](./README.md)

## Context

Today a Home row opens the sandbox configuration page, and reaching chat from there takes
the "Open in" menu — three clicks for the most common thing anyone does. This slice makes
the row click open chat, and makes a hibernated sandbox start on its own once the chat is
open, so the landing is a working chat rather than an overlay asking for one more click.

See `screens/DAM.png` for the list this changes.

## Implementation plan

1. **New hook** `packages/ui/src/modules/agents/hooks/use-auto-wake-on-open.ts`:

   - `export function useAutoWakeOnOpen(agentId: string | null): void`.
   - Read the agent from `useAgents()` (`modules/agents/api/queries.js`) — the same list the
     chat header and the overlay already read, so there is no extra request.
   - In an effect, wake when the agent is `state === "hibernated"` and **not**
     `overBudget`. Everything else is left alone: `error` needs Restart, `over_budget` needs
     the user's retry through the gate, and the transient states are already coming up.
   - Fire through `useWakeAgent()` (`../hooks/use-wake-agent.js`), which stamps the
     optimistic `restartingAgents` entry so the pill and overlay flip to "Starting"
     immediately.
   - Attempt **once per agent**: keep a `useRef<Set<string>>` of ids already tried and add
     before firing. A failed wake clears the optimistic entry, and without the guard the
     effect would re-fire on the next poll and loop.

2. **Call it from the chat view** — `packages/ui/src/modules/sessions/views/chat-view.tsx`,
   beside the existing `useAgentReachabilityProbe(selectedAgent)` call (~line 98):
   `useAutoWakeOnOpen(selectedAgent)`. Placing it here rather than in the overlay covers
   every way into chat, including the knowledge-base surface.

3. **Home rows open chat** — `packages/ui/src/modules/agents/views/list-view.tsx`: replace
   the `navigateToSandboxHome` store selector with `selectAgent`, and the row's
   `onSelect={() => navigateToSandboxHome(agent.id)}` with
   `onSelect={() => selectAgent(agent.id)}`. Drop the now-unused selector.

4. **Correct the overlay docstring** —
   `packages/ui/src/modules/agents/components/agent-unavailable-overlay.tsx`: its comment
   claims "waking is never automatic", which this slice makes false. Say instead that a
   hibernated sandbox starts by itself when its chat opens, and the buttons remain for the
   two states that need a deliberate click (parked → Start retries the budget gate,
   error → Restart). Leave the component's behavior unchanged.

5. **Update the e2e helper** — `packages/e2e/playwright/src/lib/agents.ts`:
   `gotoAgentDetail` currently clicks the sandbox heading, asserts the
   `/sandboxes/<id>` URL, then drives the "Open in" menu. Rename it to `gotoAgentChat`,
   drop the sandbox-home assertion and both menu steps, and keep only the heading click plus
   the `/chat/<id>` assertion. Fix its docstring, which describes the old route. Update the
   three callers: `tests/smoke/04-messages.spec.ts` (two calls),
   `tests/smoke/08-session-delete.spec.ts`, `tests/smoke/12-experiments.spec.ts`.

## Acceptance criteria

- [ ] Clicking a row in the Sandboxes list navigates to `/chat/<agentId>`.
- [ ] Opening the chat of a hibernated sandbox fires exactly one wake: the overlay shows "Starting" without a click, and the chat appears once the pod is ready.
- [ ] Opening the chat of a parked (`over_budget`) sandbox still shows the overlay with its Start button, and no wake is sent.
- [ ] Opening the chat of a sandbox in `error` still shows the overlay with Restart, and no wake is sent.
- [ ] A wake that fails is not retried in a loop — the overlay settles back on Start.
- [ ] The sandbox configuration page is still reachable from the chat header ⋮ → "Configure sandbox".
- [ ] `mise run --force ui:check` and `mise run --force ui:test` pass (the two pre-existing lint warnings in `experiment-dock-panel.tsx` and `files-panel-controller.ts` are expected).

## Smoke test

```
mise run --force ui:check
mise run --force ui:test
```

Then by hand, against the Vite dev server on `localhost:5173`:

1. Let a sandbox hibernate (or pause it). From Home, click its row → the URL becomes
   `/chat/<id>`, the overlay reads "Starting", and the chat opens with no further click.
2. Click a running sandbox's row → chat opens immediately, no overlay.
3. Open the chat of a parked sandbox → the parked overlay stays put with Start.

The implementing agent runs the commands itself, then prints this manual guide for the user
to confirm by hand.
