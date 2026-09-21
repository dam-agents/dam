# 09 — Read-only child view

**Depends on:** 01-design-pass, 06-delegation-block, 08-capture-at-teardown
**Part of:** Delegation visibility — see [README](./README.md)

## Context

A finished child no longer exists, so opening it means rendering the frames slice 08 stored.
This slice adds the owner-scoped read of those frames and the docked panel that shows them
read-only, in the layout the design pass agreed. The UI has no transcript renderer that
takes frames as input today, but every piece needed is pure and props-only: the
`applyUpdate` reducer, `ChatMessage`, `ChatMessagePart`. No revive, no prompting: the panel
is a viewer.

Apply `/react-ui-engineering` for the UI and `/typescript-engineering` for the procedure.
Follow the README `## Design` section.

## Implementation plan

1. **Procedure** — `packages/api-server-api/src/modules/invocations/router.ts`:
   `transcript: readAgentProcedure.input({ driverAgentId, id }).query(...)` with
   `checkAgentBinding(ctx, input.driverAgentId)`. The query service resolves the row, checks
   it belongs to the driver's root and owner, reads the object through
   `Pick<ArtifactService, "get">`, splits lines, returns `{ frames, truncated }`. A row
   without a key returns `NOT_FOUND`.
2. **Query** — `packages/ui/src/modules/invocations/api/queries.ts`:
   `useDelegationTranscript(driverAgentId, id, enabled)`; stale forever, the object is
   immutable.
3. **Fold frames to messages** — `packages/ui/src/modules/invocations/lib/frames-to-messages.ts`:
   parse each frame, take `params`, and reduce with
   `applyUpdate(messages, update, frame._meta.platform.at, telemetryPromptId)` from
   `modules/acp/session-projection.ts`. The runtime's history providers stamp
   `_meta.platform.at` per frame, so timestamps come through.
4. **Panel** — `packages/ui/src/modules/invocations/components/docked-delegation-panel.tsx`,
   a fourth panel in the right column of `modules/sessions/views/chat-view.tsx:850-902`
   with the `h-12` header row the other docked panels use: label, status dot, duration,
   cost (from the tree and spend queries slice 06 already holds), a read-only marker, close.
   Body: `ChatMessage` per folded message with no-op `onRetry`/`onFileClick`/`onDelete` and
   `hasPendingPermission={false}`, plus the thread dividers from
   `modules/sessions/lib/thread-items.ts`. Show a "conversation was cut" notice when
   `truncated`. The footer's "Continue in new session" button from the design ships
   behind a constant set to false until the follow-up issue lands; render nothing for it. Panel state lives in `modules/invocations/store.ts` (`openDelegationId`),
   following `modules/artifacts/store.ts`'s `openArtifactId`; add it to the precedence chain
   in `chat-view.tsx`, and to `use-dock-draft-guard.ts` if it guards docked panels.
   If the design pass chose a sidebar instead, place the same component there and skip the
   dock wiring.
5. **Wire the open control** from slice 06: a finished node with `transcriptAvailable`
   opens the panel; a finished node without it shows a disabled control with a tooltip
   "conversation was not captured". A running node still opens the child's live chat.

## Acceptance criteria

- [ ] Clicking a finished child opens the panel with its conversation, ending with the
      `report_result` call, and a read-only marker.
- [ ] The panel is resizable and closable like the file and artifact panels, and closing it
      returns to the driver's chat unchanged.
- [ ] A child without a stored conversation shows the disabled control with the tooltip.
- [ ] A user whose key is not bound to the driver gets `FORBIDDEN` from
      `invocations.transcript`.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run test` and `mise run check`. With the UI dev server against the dev cluster, run
the README prompt, wait for both children to finish, and walk README step 6. Then spawn a
child that never reports (slice 08's smoke case) and confirm its row shows the disabled
control.
