# 05 — Panel controls and header indicator

**Depends on:** 02-keep-marks-and-stop, 03-restart-deferral, 04-processes-panel
**Part of:** Agent processes panel — see [README](./README.md)

## Context

The read-only panel from 04 gets its controls: a **Stop** button per row, a per-row switch
between "Keeps the agent awake" and "Stops at hibernation" with who decided, and a banner for
a settings change held back by kept Harness Tasks with **Apply now (stops N tasks)**. A
header indicator in the chat view shows what runs and opens the Processes section. All of
it is behind the `processes` flag. With the flag off, today's background-work indicator stays
as it is.

## Implementation plan

Apply `/react-ui-engineering` throughout.

1. **Mutations** in `packages/ui/src/modules/processes/api/mutations.ts` (or next to
   `queries.ts`, following the files module): `useStopProcess`, `useSetKeep`,
   `useApplyPendingRestart`, each calling the `processes` router through the same client
   choice as the queries and invalidating `processKeys.agent(agentId)` on settle. Show errors
   with the existing toast (`components/ui/sonner.tsx`). The runtime messages are written to
   be shown.
2. **Stop** in `process-row.tsx`: a Stop button opening `components/ui/confirm-dialog.tsx`
   ("Stop `<command>`? It and the processes it started end now."). Disabled with a tooltip
   ("Can't find this task's process") when `pid` is `null`. Foreground rows can be stopped
   too, and the confirm text says the agent's current step will fail.
3. **Keep switch** in `process-row.tsx` (`components/ui/switch.tsx`), not on Foreground rows:
   - On: "Keeps the agent awake". Off: "Stops at hibernation", or "Runs until stopped" on an
     Always-on agent (04's wording).
   - A caption under it says who decided: "Agent's choice" (`agent`), "Your choice"
     (`user`), and for `default`: "Background task" on a Harness Task, nothing on a
     Detached row.
   - On an Always-on agent, the switch changes nothing the user can feel, so disable it and
     explain in a tooltip: "This agent is Always on. Nothing here stops at hibernation."
4. **Pending-change banner** at the top of `processes-panel.tsx`, when
   `pendingRestart` is set (`components/ui/callout.tsx`): "A settings change is waiting for
   N background task(s) to finish." The button "Apply now (stops N tasks)" opens a confirm,
   then calls `useApplyPendingRestart`. Below it, a short hint: stopping or unkeeping the task
   also lets the change apply.
5. **Header indicator** `components/processes-indicator.tsx`. In `ChatHeaderStatus` in
   `packages/ui/src/modules/sessions/views/chat-view.tsx`, when the flag is on, render it in
   place of `BackgroundWorkIndicator`. With the flag off, keep `BackgroundWorkIndicator`
   unchanged (e2e tests use its `data-testid`).
   - It shows nothing when no Harness Task or Detached Process runs.
   - Otherwise: "N running", plus "· M keeping it awake" when M > 0, plus a dot when
     `pendingRestart` is set.
   - Click opens the Processes section (`setProcessesSectionOpen(true)`) and scrolls it into
     view.
   - It reads `useProcesses`, so it shares 04's query and watch. Run the watch while the
     indicator is mounted, not only while the section is open.
6. **Docs.** In [features](../../architecture/features.md), describe what the flag shows, in
   one sentence next to 04's entry. In
   [agent-lifecycle](../../architecture/agent-lifecycle.md), state that the user's choice
   wins over the agent's, and how a user sees why an agent stays awake (the panel), where
   the page today says "What is held is published on the runtime's status surface". Move
   Turn Process, Harness Task, Detached Process and Keep Mark from *proposed* to settled in
   [`docs/ubiquitous-language.md`](../../ubiquitous-language.md). Bump `Last verified:`.

## Acceptance criteria

- [ ] Stop asks for confirmation, ends the process, and the row moves to finished as
      "Stopped by you". It is disabled with a tooltip for a Harness Task without a pid.
- [ ] Flipping the switch updates the row and its caption to "Your choice", and the agent's
      later `platform-keep --pid` on it is refused.
- [ ] On an Always-on agent, the switch is disabled with the explanation.
- [ ] With a kept Harness Task and a new connection, the banner shows the right count, and
      Apply now restarts the harness and clears the banner.
- [ ] The header indicator shows counts, opens the section, and is hidden when nothing runs.
      With the flag off, the old indicator renders as before.
- [ ] `mise run //packages/ui:check`, `mise run //packages/ui:test` and
      `mise run check:comment-types` pass, and the existing e2e suite still passes on the
      test cluster (`mise run e2e:loop`, or the subset touching chat-view).

## Smoke test

1. Run the checks above.
2. `mise run cluster:build ui agents`, hard-reload, and make sure the flag is on.
3. In a claude-code agent: start a `run_in_background` loop and a
   `platform-keep -- sh -c 'sleep 300'`. The header says "2 running · 2 keeping it awake".
   Clicking it opens the section.
4. Switch the background task off. The caption says "Your choice", and the header says
   "· 1 keeping it awake".
5. Switch it back on, then add a connection. The banner appears with "Apply now (stops 1
   task)". Apply. The banner clears, and the task is under finished.
6. Stop the `platform-keep` row. It moves to finished as "Stopped by you", and the header
   indicator disappears.
7. Turn the flag off. The old indicator is back.

Then print a short manual smoke-test guide for the user that repeats steps 3–7.
