# 04 — Processes panel (read-only)

**Depends on:** 01-process-inventory
**Part of:** Agent processes panel — see [README](./README.md)

## Context

The user gets a **Processes** section in the chat view's left sidebar, stacked with
Sessions, Files and Artifacts, behind a new per-user experimental flag `processes`. It lists
running processes (Foreground, Harness task, Detached) with command, run time, CPU, memory and
whether each keeps the agent awake, plus a "Recently finished" list. A row's **Output** opens
the output file's tail in the right docked panel, the way a file opens. Updates are live
through `processes.watch`. This slice shows only: Stop, the keep switch and the header
indicator come in 05.

## Implementation plan

Apply `/react-ui-engineering` throughout.

1. **Flag.**
   - Add `"processes"` to `featureIdSchema` in
     `packages/api-server-api/src/modules/features/schemas.ts`. The repository stores the id
     as a string, so no migration is needed.
   - Add a `FEATURE_ROWS` entry in `packages/ui/src/modules/features/components/features-tab.tsx`:
     label "Processes panel", description "See what runs in your agent, what keeps it awake,
     and what finished while you were away."
   - Add a hook `packages/ui/src/modules/processes/hooks/use-processes-enabled.ts`, the same
     as `modules/agents/hooks/use-agent-avatars.ts`.
   - Add the flag to [features](../../architecture/features.md)'s list of current features.
2. **New UI module** `packages/ui/src/modules/processes/`:
   - `api/keys.ts`: `processKeys.agent(agentId)`, `processKeys.output(agentId, key)`.
   - `api/queries.ts`: `useProcesses(agentId)` calls `processes.list` through the same
     `clientFor` choice as `modules/files/api/queries.ts` (`agentTrpc` or `agentTrpcHttp`
     when `useAgentLacksLiveUpdates`). Enabled only while the agent is operable
     (`useIsAgentOperable`), and refetched every 5 s while the section is open, for CPU and
     memory. `useProcessOutput(agentId, key)` calls `processes.output` and refetches every 3 s
     while that row is still running.
   - `hooks/use-processes-watch.ts`: copy `modules/files/hooks/use-workspace-watch.ts`.
     Subscribe to `processes.watch` with `watchWithRetry` (`lib/watch-retry.ts`), and on each
     notice `invalidateQueries(processKeys.agent(agentId))`. Run it only while the section
     is open and the flag is on.
   - `store.ts`: `processesSectionOpen` and its setter, plus `openProcessOutputKey` and its
     setter, in the same shape as `modules/files/store.ts` and `modules/artifacts/store.ts`.
     Opening an output closes an open file, artifact or delegation, and the other way round,
     the same way those three already exclude each other.
   - `components/processes-panel.tsx`: the section body. It shows the running rows grouped
     in this order: Foreground, Harness tasks, Detached. Then a collapsible
     "Recently finished" (`components/ui/disclosure.tsx`). When the agent isn't running, show
     an empty state: "Processes show once the agent is running." The same goes for an empty
     list ("Nothing is running").
   - `components/process-row.tsx`:
     - kind label: Foreground / Harness task / Detached
     - command in mono, start-truncated, full text in a tooltip
     - run time (relative, from `startedAt`), CPU %, memory (formatted)
     - keep status as text: "Keeps the agent awake" or "Stops at hibernation". When the
       agent is Always on (`agentView.hibernationTimeoutMin === 0`), say "Runs until
       stopped" instead of "Stops at hibernation". Foreground rows show "Ends with the turn".
     - an **Output** button when `outputPath` is set
   - `components/finished-row.tsx`: command, how it ended ("Exited", "Stopped by you",
     "Ended by hibernation"), finished time (relative), and Output if `outputPath`.
   - `components/docked-process-output-panel.tsx`: header with the command and path, a
     mono, scrollable body that sticks to the bottom while running, a "showing the last
     64 KiB" note when `truncated`, and a close button.
3. **Chat view wiring** (`packages/ui/src/modules/sessions/views/chat-view.tsx`):
   - Add `"processes"` to `SidebarPanelId` in `modules/sessions/lib/sidebar-panels.ts` and its
     weights. Render the section with `PanelDivider` after Artifacts, through
     `useSidebarPanels`, only when the flag is on. With the flag off, the panel list must
     equal today's, so stored weights and dividers don't shift.
   - Add `openProcessOutputKey` to the docked-panel condition (around the
     `DockedFilePanel` / `DockedArtifactPanel` switch) and render
     `DockedProcessOutputPanel`.
4. **Copy** lives in the components. Never put the brand name in copy (use "agent").

## Acceptance criteria

- [ ] With the flag off, the chat view looks and behaves exactly as before (no section, same
      sidebar weights).
- [ ] With the flag on, the Processes section lists running rows grouped by kind and the
      finished list, with the pinned fields.
- [ ] A process the agent starts or that exits appears or moves within a few seconds without
      a reload (watch). CPU and memory refresh about every 5 s while the section is open.
- [ ] Output opens in the docked panel, follows a running file, and closes an open file or
      artifact view (and the other way round).
- [ ] An Always-on agent's unkept rows say "Runs until stopped".
- [ ] A hibernated agent shows the empty state and makes no `processes.*` calls.
- [ ] `mise run //packages/ui:check`, `mise run //packages/ui:test`,
      `mise run //packages/api-server-api:check` and `mise run check:comment-types` pass.

## Smoke test

1. Run the checks above.
2. `mise run cluster:build ui` (and `agents` if 01 isn't on the cluster yet). Hard-reload the
   tab.
3. Turn on Settings → Experimental features → Processes panel (tap the version five times to
   reveal the tab).
4. In a claude-code agent, ask for `nohup sh -c 'for i in $(seq 1 120); do echo $i; sleep 1; done' > ~/n.log 2>&1 &`.
   The row appears as Detached, "Stops at hibernation". Output shows the count growing.
5. Wait until it ends. It moves to Recently finished as "Exited", and Output still opens.
6. Turn the flag off. The section is gone, and the sidebar looks as before.

Then print a short manual smoke-test guide for the user that repeats steps 3–6.
