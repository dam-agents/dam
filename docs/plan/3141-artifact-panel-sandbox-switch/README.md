# Artifact panel stays open when switching sandboxes

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3141

## Goal

Opening a sandbox's chat — any sandbox, including a freshly created one — starts with the
right-hand dock closed. An artifact opened while viewing one sandbox must not remain docked
after the user moves to another, where it reads as if it belonged to the new (often empty)
sandbox.

## Approach

The chat view's right-hand dock renders exactly one of three panels, in priority order:
the file viewer (`openFilePath`), the artifact preview (`openArtifactId`), or the experiment
panel ([`chat-view.tsx:840`](../../../packages/ui/src/modules/sessions/views/chat-view.tsx#L840)).
The first two are plain global fields on the zustand store — neither is keyed by agent — so
their lifetime is defined entirely by who clears them. The third is already agent-scoped:
`useDockedExperiment(selectedAgent)` derives it from that agent's experiments and keys its
manual override on `agentId` + `sessionId`, so it needs no change.

Every route into and out of chat funnels through one teardown function,
`resetChatContext()` in
[`modules/sessions/store/sessions.ts`](../../../packages/ui/src/modules/sessions/store/sessions.ts) —
called by `selectAgent`, `openKnowledgeBase`, `openAgentSession`, `openAgentTerminal` and
`goBack` in
[`modules/agents/store.ts`](../../../packages/ui/src/modules/agents/store.ts), and by the app's
single popstate listener in
[`use-browser-history.ts`](../../../packages/ui/src/modules/platform/hooks/use-browser-history.ts).
Its own contract is "wipe all per-chat-session state", and it already clears `openFilePath`.
It does **not** clear `openArtifactId` — which is the entire bug. Because it is the one
chokepoint, fixing it there covers all six entry points, including the sandbox-creation
wizard (which finishes by calling `selectAgent` / `openKnowledgeBase`) and browser
back/forward.

The docked artifact preview is therefore **chat-context state**, with the same lifetime as
the open file and the message list — not a user preference that should survive navigation.
That is the invariant this fix establishes, and the reason the fix belongs in the teardown
function rather than in the artifacts slice or the panel component.

### In scope beyond the reported symptom

`resetChatContext` sets `openFilePath: null` directly rather than through `setOpenFilePath`,
so it also leaves `openFileDirty` and `openFileEdit` behind. A lingering
`openFileDirty: true` makes the *next* sandbox's first file click pop a spurious "Discard
unsaved changes?" confirm
([`use-file-tree.ts:39`](../../../packages/ui/src/modules/files/hooks/use-file-tree.ts#L39))
for an editor that no longer exists. Same dock, same class of leak, same three lines —
fixed together so the teardown is complete rather than half-done.

### Explicitly out of scope

- `artifactsSectionOpen` / `filesSectionOpen` — collapse state of the chat sidebar's
  sections. These are user preferences; carrying them across sandboxes is the desired
  behavior. Do not touch them.
- `dockedExperiment` — already agent-scoped, as described above.
- The artifacts destination view and the sandbox-home artifacts section — they preview via
  `ArtifactPreviewDialog`, not the docked panel, and never read `openArtifactId`.
- Making `openArtifactId` agent-keyed (e.g. `Record<agentId, artifactId>`). That would
  *restore* the panel on return to a sandbox, which is more state than the issue asks for
  and diverges from how `openFilePath` behaves. Reject it.

## Conventions & glossary

- **Dock** — the chat view's right-hand panel area, shared by the file viewer, the artifact
  preview, and the experiment panel; at most one is visible at a time.
- **Chat context** — the per-sandbox, per-session UI state torn down by `resetChatContext`:
  active session, messages, session error, queued prompt, pending permissions, and dock
  state.
- Apply the [`/react-ui-engineering`](../../../.claude/skills/react-ui-engineering/SKILL.md)
  skill: this is `packages/ui` React + zustand work. Run `mise run lint:fix` after edits
  (auto-fixes import order and `import type`), per
  [`packages/ui/CLAUDE.md`](../../../packages/ui/CLAUDE.md).
- Documentation edits follow
  [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md) —
  including bumping `Last verified:` on any architecture page you touch.

## Whole-feature smoke test

Against the local dev cluster (see the
[`cluster-ops`](../../../.claude/skills/cluster-ops/SKILL.md) skill), replay the issue's
reproduction steps in a single page session — no reload between steps, since a reload would
clear the in-memory store and mask the bug:

1. Open a sandbox that has at least one artifact; open that artifact from the chat sidebar's
   Artifacts section so it docks on the right.
2. Without reloading, navigate to another sandbox — use both paths, since they hit different
   store actions: (a) Back to the sandbox list, then open a different sandbox; (b) create a
   new Knowledge base sandbox through the wizard and let it land in chat.
3. In each case the dock is closed on arrival: no artifact panel, no stale preview.
4. Return to the first sandbox: the dock is closed there too (state is not restored — that
   is intended).
5. Regression check on the other dock occupants: open a file in sandbox A, switch to sandbox
   B — dock closed, and B's first file click opens immediately with no "Discard unsaved
   changes?" prompt. Open a sandbox with a live or draft experiment run — the experiment
   panel still docks itself as before.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3141.
