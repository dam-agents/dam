# 01 — Reset the docked artifact panel on chat teardown

**Part of:** Artifact panel stays open when switching sandboxes — see [README](./README.md)

## Context

`resetChatContext()` is the single teardown every route into and out of chat calls, and it
already clears the docked file viewer — but not the docked artifact preview, so an artifact
opened in one sandbox stays docked when the user moves to another. This slice completes that
teardown: the artifact preview, and the two file-viewer flags the same function currently
misses, are cleared alongside `openFilePath`.

## Implementation plan

Apply the [`/react-ui-engineering`](../../../.claude/skills/react-ui-engineering/SKILL.md)
skill while implementing.

1. **Extend the teardown.** In
   [`packages/ui/src/modules/sessions/store/sessions.ts`](../../../packages/ui/src/modules/sessions/store/sessions.ts),
   in the `resetChatContext` implementation (around line 98), add to the `set({ … })` object,
   next to the existing `openFilePath: null`:

   - `openArtifactId: null` — the reported bug.
   - `openFileDirty: false` and `openFileEdit: false` — `resetChatContext` sets
     `openFilePath` directly instead of going through `setOpenFilePath`, so without these two
     the flags outlive the viewer they describe (see the README's "In scope beyond the
     reported symptom").

   These fields belong to the files and artifacts slices, not the sessions slice; that is
   fine and already the established pattern here — the slice is typed against the whole
   `PlatformStore`, which is exactly why `openFilePath` and `pendingPermissions` are already
   set from this function. Do not reach for the setter actions instead: `setOpenArtifactId`
   / `setOpenFilePath` exist to maintain the dock's mutual exclusion when *opening*
   something, and a full wipe has no exclusion to maintain. One flat `set` keeps the reset
   atomic (one store notification, one re-render).

2. **Update the doc comment.** The JSDoc above `resetChatContext` (around line 53) enumerates
   what it wipes — "active session, messages, file tree, session config, queued prompt". Fold
   the dock into that list so the comment still describes the function, e.g. name the docked
   file/artifact panel rather than just "file tree". Keep it to the existing one-sentence
   register; do not expand it into a rationale.

3. **Record the invariant in the architecture doc.** In
   [`docs/architecture/artifact-library.md`](../../architecture/artifact-library.md), the
   "UI surfaces" section describes the chat **docked preview** and already closes with the
   companion rule "Deleting the artifact a preview is showing closes that preview." Add one
   sentence in the same register stating that the docked preview is chat-scoped — leaving the
   sandbox's chat closes it, and it is not restored on return. Bump `Last verified:` at the
   top of the page to the current date, per the documentation guidelines. Do not document the
   store field names or the function name — the page describes behavior, not the UI's
   internals.

4. **Lint.** Run `mise run lint:fix`.

Nothing else changes. In particular, leave `artifactsSectionOpen` / `filesSectionOpen`
untouched (sidebar collapse preferences, correctly persistent), and leave
`useDockedExperiment` untouched (already agent-scoped).

**No new tests.** There are no unit tests over the store slices
(`packages/ui/src/__tests__/unit/` covers pure helpers only), and the behavior is directly
observable in the app, so it is verified by the existing suite plus the manual smoke below.

## Acceptance criteria

- [ ] `resetChatContext` clears `openArtifactId`, `openFileDirty` and `openFileEdit` in
      addition to the state it already cleared.
- [ ] Its JSDoc lists the dock among the state it wipes.
- [ ] `artifactsSectionOpen`, `filesSectionOpen`, and `useDockedExperiment` are unchanged.
- [ ] `docs/architecture/artifact-library.md` states the docked preview's chat-scoped
      lifetime and carries a bumped `Last verified:` date.
- [ ] `mise run check` and `mise run test` pass.
- [ ] Manually: with an artifact docked in sandbox A, entering sandbox B's chat shows a
      closed dock — verified both via the sandbox list and via a newly created sandbox from
      the wizard.
- [ ] Manually: browser Back out of a chat with an artifact docked, then re-enter any chat —
      dock closed.

## Smoke test

1. `mise run check` and `mise run test` — the existing suite, which must stay green
   (TypeScript will reject the new fields if any of the three names are wrong, since the
   `set` is typed against `PlatformStore`).
2. Build and serve the UI against the local dev cluster
   (`mise run cluster:build-ui`; see the
   [`cluster-ops`](../../../.claude/skills/cluster-ops/SKILL.md) skill), then run the
   README's whole-feature smoke test — it is the same check for this slice, since the slice
   is the whole feature. Load the app over `http://localhost:4444`, and if the change appears
   not to have applied, confirm the served bundle rather than debugging the code: the PWA
   service worker serves a stale bundle after a UI build.
3. Perform the navigation steps **without reloading the page** between them. The store is
   in-memory only, so a reload clears `openArtifactId` on its own and would hide both the
   bug and the fix.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
