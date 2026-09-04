# 03 — Drag-to-folder in the panel

**Depends on:** 01-extract-drag-orchestration, 02-panel-folder-groups
**Part of:** Artifacts panel folders — see [README](./README.md)

## Context

Filing an artifact the moment the agent publishes it is the issue's core drag scenario. With
groups in place (02) and the orchestration hook extracted (01), this slice makes panel rows
draggable and folder headers drop targets, per [`design/DAM-2.png`](./design/DAM-2.png).

## Implementation plan

Apply the /react-ui-engineering skill. All paths under `packages/ui/src/modules/artifacts/`.

1. Consume `hooks/use-folder-drag-orchestration.ts` (from 01) in the panel: rows get
   `useArtifactRowDrag`-based props (drag-opacity like `artifact-row.tsx` ~82–90), group
   headers get `useFolderDropTarget`-based props with the hot-folder highlight (the library
   uses `ring-2 ring-inset ring-primary`; match the sidebar's visual language).
2. Drag affordance per the design: a drag handle (⇕) at the row's left edge, visible on
   hover/drag ([`design/DAM-2.png`](./design/DAM-2.png)).
3. Drop targets: every user folder header (empty ones included — that's why they're listed) and
   the Ungrouped header (moves `folderId` to null). Empty experiment folders are not targets;
   same-folder drops are no-ops (the hook already skips them).
4. A collapsed folder must accept drops without needing to expand first.
5. Move goes through the hook's existing `useUpdateArtifact` path — optimistic, with rollback;
   the library page picks the change up via the shared cache/invalidation.

## Acceptance criteria

- [ ] A panel row drags with the handle affordance; the hovered folder header highlights.
- [ ] Dropping files the artifact into that folder (including an empty folder and a collapsed
      one); dropping on Ungrouped un-files it; counts update optimistically.
- [ ] Library page drag/drop still works identically (shared hook, no regression).
- [ ] Keyboard/menu path untouched: "Move to folder…" still works from the row menu.
- [ ] `mise run ui:check`, `mise run ui:test`, `mise run common:check:comment-types` pass.

## Smoke test

`mise run ui:test` and `mise run ui:check`. Manually on the Vite dev server: from the chat
panel drag an ungrouped artifact into a folder, into the empty folder, and back to Ungrouped;
verify against [`design/DAM-2.png`](./design/DAM-2.png) and check the Artifacts page reflects
each move. Print those steps as the manual guide for the user.
