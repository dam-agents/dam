# 01 — Extract folder-drag orchestration

**Part of:** Artifacts panel folders — see [README](./README.md)

## Context

The library view holds the drag/drop *orchestration* inline — which folder is hot, which
artifact is being dragged, showing "Ungrouped" as a target mid-drag, and the drop→move call.
Sub-issue 03 needs the identical logic in the chat panel, so this slice lifts it into a hook
first. Pure refactor: the library must behave byte-for-byte the same.

## Implementation plan

Apply the /react-ui-engineering skill. All paths under `packages/ui/src/modules/artifacts/`.

1. Read `views/artifacts-view.tsx` ~57–110: `hotFolderId`, the drag-origin id, the
   show-ungrouped-while-dragging rule, no-op-move skip, and `onDrop` →
   `useUpdateArtifact().mutate({ id, folderId })`.
2. Extract into `hooks/use-folder-drag-orchestration.ts`: returns per-row drag callbacks
   (compose with `useArtifactRowDrag`), per-folder drop-target props (compose with
   `useFolderDropTarget` and its `FolderDropCallbacks` seam, `hooks/use-artifact-row-drag.ts`
   ~15–19), the `hotFolderId`/`draggingId` state, and the drop handler that calls the update
   mutation and skips same-folder drops.
3. Rewire `artifacts-view.tsx` (and through it `FolderGroup` / `ArtifactRow` props) onto the
   hook. No visual or behavioral change; `components/folder-group.tsx`'s `dropActive` ring and
   `components/artifact-row.tsx`'s drag-opacity stay as they are.
4. Keep the hook presentation-free (no JSX) so the dense sidebar rows can consume it unchanged.

## Acceptance criteria

- [ ] `artifacts-view.tsx` no longer holds drag state inline; the hook is the only orchestrator.
- [ ] Library drag/drop behavior unchanged: hot-folder ring, Ungrouped appearing as a target
      during drag, no-op move skipped, optimistic move with rollback.
- [ ] No prop-shape churn in `ArtifactRow`/`FolderGroup` beyond sourcing values from the hook.
- [ ] `mise run ui:check`, `mise run ui:test`, `mise run common:check:comment-types` pass.

## Smoke test

`mise run ui:test` and `mise run ui:check`. Manually on the Vite dev server: on the Artifacts
library page, drag an artifact between two folders and into Ungrouped; confirm the hot-folder
ring, the move, and that dropping an artifact on its own folder does nothing. Print those steps
as the manual guide for the user.
