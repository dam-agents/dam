# 05 — Sandbox home grouped by folder

**Depends on:** 02-panel-folder-groups
**Part of:** Artifacts panel folders — see [README](./README.md)

## Context

The agent page's Artifacts section is the same flat list the chat panel was. This slice applies
the folder grouping there, so the organization carries over to every surface listing an agent's
artifacts.

## Implementation plan

Apply the /react-ui-engineering skill. All paths under `packages/ui/src/modules/artifacts/`.

1. `components/sandbox-artifacts-section.tsx` (flat `ArtifactRow` map at ~74–85, agent-scoped
   query at ~26): group by folder with the same rules as the chat panel — user folders (empty
   collapsed), agent-scoped contents, local counts, Ungrouped last, experiment folders only when
   non-empty.
2. Reuse what 02 built. If the panel's group component is sidebar-shaped, generalize it or add a
   card-density variant rather than duplicating the grouping logic; this section keeps
   `ArtifactRow` as its row.
3. Collapse state: same store pattern, keyed per agent (shared with or parallel to the panel's —
   implementer's call, but one source of truth per surface).
4. Drag-to-folder here is a bonus, not required — include it only if it falls out of the shared
   pieces for free; the row menu's "Move to folder…" already covers this surface.

## Acceptance criteria

- [ ] The sandbox home Artifacts section shows the same folder grouping and counts as the chat
      panel, with `ArtifactRow` rows and all existing actions intact.
- [ ] No duplicated grouping logic — shared with 02's implementation.
- [ ] `mise run ui:check`, `mise run ui:test`, `mise run common:check:comment-types` pass.

## Smoke test

`mise run ui:test` and `mise run ui:check`. Manually on the Vite dev server: open the agent's
home view → Artifacts section; groups and counts mirror the chat panel for the same agent;
collapse state toggles; row actions (share, rename, move, delete) still work. Print those steps
as the manual guide for the user.
