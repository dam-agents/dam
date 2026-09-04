# Chat sidebar sections open by default, and remember the collapse choice

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3455

## Goal

A user opens a chat and sees the session's artifacts immediately, with no click.
The Artifacts section in the chat sidebar starts expanded instead of collapsed.

The collapse control stays. When a user collapses a section, that choice survives a
reload. This applies to all three sidebar sections — Sessions, Files and Artifacts —
so the sidebar behaves as one thing rather than one section that remembers and two
that forget.

## Approach

The chat view stacks three sections in its left sidebar
([`chat-view.tsx:552-592`](../../../packages/ui/src/modules/sessions/views/chat-view.tsx)).
Each carries an open flag, and today none of them persists:

| Section   | Default | State lives in                                | Survives reload |
| --------- | ------- | --------------------------------------------- | --------------- |
| Sessions  | open    | local `useState(true)` in `chat-view.tsx`      | no              |
| Files     | open    | `filesSectionOpen` in the files slice          | no              |
| Artifacts | closed  | `artifactsSectionOpen` in the artifacts slice  | no              |

The change is therefore two things, not one: flip the Artifacts default, and add
persistence that does not exist yet for any section.

Each flag stays in its own module slice, so the module boundaries hold — the files
module keeps its own flag, the artifacts module keeps its own. Only the persistence
mechanism is shared: one small helper reading and writing a boolean `localStorage`
key. Sessions moves from local component state into the sessions slice so all three
flags work the same way.

The precedent for a persisted preference is
[`readStoredSidebarExpanded`](../../../packages/ui/src/modules/platform/store/sidebar.ts) —
a `platform-*` key, read at slice init, `try`/`catch` around every `localStorage`
call, `"1"`/`"0"` encoding. The new helper generalises exactly that, and the sidebar
slice folds onto it. Chat layout state already persists this way through raw
`platform-left-w`, `platform-file-w` and `platform-sessions-h` keys, so the storage
namespace is established.

This is a UI-only change. No tRPC contract moves, no api-server code, no schema.
The [artifact library architecture](../../architecture/artifact-library.md) describes
the chat sidebar Artifacts section under "UI surfaces"; nothing there changes, because
the page does not document a default open state.

### Decisions already settled

- **Expand even when the session has no artifacts.** One rule, no flicker, no
  wait-for-the-list-then-pop-open. The panel already renders "No artifacts yet" for
  the empty case, so no new copy is needed.
- **Persist globally, not per agent.** One key per section. A user sets the layout
  once for the whole app.
- **All three sections persist**, not Artifacts alone.

### Consequences, accepted

- `artifactLibrary.list` now runs on every chat landing, because
  [`ChatArtifactsPanel`](../../../packages/ui/src/modules/artifacts/components/chat-artifacts-panel.tsx)
  gates its query on `open`. The procedure is a plain database read — it does **not**
  call `ensureReady`, so it will not wake a stopped sandbox.
- A resize handle sits only between Sessions and Files. With three sections open,
  Sessions keeps its stored height and Files and Artifacts split the remainder evenly.
  That matches the design. **Do not add a third handle** — it is out of scope.

## Sub-issues

| #   | Title                                                        | Scope                                                                     | Depends on |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------- |
| 01  | Chat sidebar sections open by default and remember the choice | Shared persisted-flag helper, three store slices, `chat-view.tsx` cleanup | —          |

One sub-issue. The whole change is one package, one behavior, about six files.

## Conventions & glossary

- **Section** — one collapsible block in the chat left sidebar, rendered by
  [`SidebarSection`](../../../packages/ui/src/modules/sessions/components/sidebar-section.tsx).
  Not to be confused with the navigation rail, whose own expanded state is the
  unrelated `sidebarExpanded` flag.
- **Persisted flag** — a boolean under a `platform-*` `localStorage` key, encoded
  `"1"` / `"0"`, absent meaning "use the default".
- Apply the `/react-ui-engineering` skill throughout. This slice touches no
  server-side TypeScript, so `/typescript-engineering` does not apply.
- Every `localStorage` access is wrapped in `try`/`catch`. Private-mode browsers and
  blocked site data throw on access, and a sidebar preference must never break the
  chat view.

## Whole-feature smoke test

Against the dev cluster, with `mise run ui:run` serving the UI at
`http://localhost:5173`:

1. Open any agent chat. All three sections — Sessions, Files, Artifacts — are
   expanded, with no click.
2. Open a chat on an agent that has published nothing. Artifacts is still expanded
   and reads "No artifacts yet".
3. Collapse Artifacts. Reload. Artifacts is still collapsed, Sessions and Files are
   still expanded.
4. Collapse Sessions and Files too. Reload. All three are still collapsed.
5. Expand all three again. Reload. All three are still expanded.

## Delivery

One atomic commit. The feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3455.
