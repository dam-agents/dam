# 01 — Chat sidebar sections open by default and remember the choice

**Part of:** Chat sidebar sections open by default — see [README](./README.md)

## Context

The Artifacts section of the chat sidebar starts collapsed, so a user never sees what
the agent produced without knowing the panel exists. This slice flips it open, and
gives all three sidebar sections a collapse choice that survives a reload. Everything
lives in `packages/ui`. Apply the `/react-ui-engineering` skill while implementing.

## Implementation plan

### 1. Add the shared persisted-flag helper

Create `packages/ui/src/lib/persisted-flag.ts` with a read and a write function. The
read takes the storage key and the default used when nothing is stored; the write
encodes `"1"` / `"0"`. Both swallow `localStorage` failures, because private-mode
browsers throw on access and a layout preference must never break the chat view.

Model it on the existing
[`readStoredSidebarExpanded`](../../../packages/ui/src/modules/platform/store/sidebar.ts),
generalised over the key and the default. Keep the module in the flat, tiny style of
its neighbours in `packages/ui/src/lib/` — see `breakpoints.ts`.

### 2. Persist the Artifacts flag and flip its default

In [`packages/ui/src/modules/artifacts/store.ts`](../../../packages/ui/src/modules/artifacts/store.ts):

- Export the storage key `platform-artifacts-open`.
- Initialise `artifactsSectionOpen` from the helper with default `true`, replacing the
  hard-coded `false` on line 19.
- Have `setArtifactsSectionOpen` write through the helper before it calls `set`.

### 3. Persist the Files flag

In [`packages/ui/src/modules/files/store.ts`](../../../packages/ui/src/modules/files/store.ts),
apply the same three steps with the key `platform-files-open` and default `true`.
`filesSectionOpen` is on line 52 and its setter on line 65.

### 4. Move the Sessions flag into the store and persist it

In [`packages/ui/src/modules/sessions/store/sessions.ts`](../../../packages/ui/src/modules/sessions/store/sessions.ts),
add `sessionsSectionOpen: boolean` and `setSessionsSectionOpen: (open: boolean) => void`
to `SessionsSlice`, with the key `platform-sessions-open` and default `true`. Follow the
declaration order the slice already uses — state fields first, setters after.

### 5. Rewire the chat view

In [`packages/ui/src/modules/sessions/views/chat-view.tsx`](../../../packages/ui/src/modules/sessions/views/chat-view.tsx):

- Delete the local `const [sessionsOpen, setSessionsOpen] = useState(true);` on line 174.
- Read `sessionsSectionOpen` and `setSessionsSectionOpen` from the store, beside the
  existing `filesSectionOpen` and `artifactsSectionOpen` reads around lines 153-160.
- Update the four remaining `sessionsOpen` references — lines 555, 559, 560 and 565 —
  to the store value, and switch the toggle from the functional updater
  `setSessionsOpen((o) => !o)` to `setSessionsSectionOpen(!sessionsSectionOpen)`, matching
  how the Files and Artifacts toggles already read.
- Leave `useState` imported. Other local state in the file still uses it.

Change nothing about `sectionFlex`, the `ResizeHandle` placement, or the
`sessionsOpen && filesSectionOpen ? sessionsH : undefined` height rule. With three
sections open, Sessions keeps its stored height and Files and Artifacts split the
remainder. That is the intended layout.

### 6. Fold the navigation-rail flag onto the helper

In [`packages/ui/src/modules/platform/store/sidebar.ts`](../../../packages/ui/src/modules/platform/store/sidebar.ts),
replace the bespoke `readStoredSidebarExpanded` body and the inline `setItem` with
calls to the new helper, keeping the `platform-sidebar-expanded` key and its default
of `false`. This is behavior-preserving: the old code treated an absent value as
`false`, and so does the helper with that default. Keep the exported key constant and
the exported reader — removing them would widen the diff for no gain.

## Acceptance criteria

- [ ] `packages/ui/src/lib/persisted-flag.ts` exists, and is the only place in the
      three section slices that touches `localStorage`.
- [ ] With no stored values, a chat opens with Sessions, Files and Artifacts all
      expanded.
- [ ] Collapsing any section writes `"0"` under its `platform-*` key; expanding writes
      `"1"`.
- [ ] Each section restores its stored state on reload, independently of the other two.
- [ ] An agent with no artifacts still shows the Artifacts section expanded, reading
      "No artifacts yet".
- [ ] `sessionsOpen` no longer exists as local state in `chat-view.tsx`.
- [ ] `platform-sidebar-expanded` still defaults to collapsed, and the navigation rail
      behaves exactly as before.
- [ ] `mise run ui:check`, `mise run ui:test` and
      `mise run common:check:comment-types` all pass.

## Smoke test

Run the existing checks:

```
mise run ui:check ::: ui:test ::: common:check:comment-types
```

Then, against the dev cluster with `mise run ui:run` serving at
`http://localhost:5173`:

1. Clear the three keys — in the browser console,
   `["platform-sessions-open","platform-files-open","platform-artifacts-open"].forEach(k => localStorage.removeItem(k))`
   — and reload. All three sections are expanded.
2. Open a chat on an agent that has published nothing. Artifacts is expanded and reads
   "No artifacts yet".
3. Collapse Artifacts, reload, and confirm it stays collapsed while Sessions and Files
   stay expanded. `localStorage.getItem("platform-artifacts-open")` returns `"0"`.
4. Repeat step 3 for Sessions and for Files.

Two traps worth knowing while smoke-testing this, because the whole test is
reload-based:

- The PWA service worker can serve a stale bundle after a build. If a reload shows the
  old behavior, confirm which bundle is being served before debugging the code.
- Port 5173 is shared across worktrees. If another checkout already owns it, the page
  you are looking at is not this branch.

The implementing agent runs this itself, then prints a short manual smoke-test guide so
the user can confirm it by hand.
