# A user can change the text of an artifact they own

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3556

## Goal

An owner can change the text of their own artifact from the preview they read it
in. Saving publishes a new version, so the artifact keeps its identity, its share
link and every earlier version. The version history then says which version the
owner wrote and which the agent published.

Today the artifact row offers share, rename, move, download and delete, and
opening one gives a read-only preview. The only ways to fix a typo are to ask the
agent to redo the document, or to download it, edit it and upload it again — which
mints a separate artifact, so every link already shared keeps pointing at the old
text.

## Approach

Read [`docs/architecture/artifact-library.md`](../../architecture/artifact-library.md)
before starting. It is the source of truth for this subsystem.

The write path already exists. `artifactLibrary.update` accepts new `content`,
appends a version row, keeps the slug and returns the artifact
([`artifact-library-service.ts:352`](../../../packages/api-server/src/modules/artifact-library/services/artifact-library-service.ts)).
So this feature is mostly a UI affordance over an API that works, plus two
gaps the affordance exposes.

**Gap 1 — a stale save silently wins.** `update` reads the row, then calls
`repo.advanceVersion(id, owner, row.version, patch)`. The expected version is the
one the call itself just read, not one the caller claims. An owner who opened v3,
went to lunch, and saved after the agent published v4 therefore advances the head
to v5 carrying v3's text. Nothing is lost from history, but the agent's change
disappears from the share link without a word. The fix is the one the sandbox file
editor already uses: the caller states the version it edited, and the server
refuses the write when the head has moved
([`file-viewer.tsx:78`](../../../packages/ui/src/modules/files/components/file-viewer.tsx)
passes `expectedMtimeMs` the same way).

An agent publish stays append-only and is never refused. Only the interactive
editor claims a version, because only it can hold stale text on a screen.

**Gap 2 — a version does not say who wrote it.** `library_artifact_versions` has
no author column, and `session_id` cannot stand in: terminal sessions publish with
a null session, so null means "unknown", not "the owner". A nullable author column
is the only truthful answer, and pre-existing rows keep a null author.

The UI reuses what exists rather than building an editor: `CodeEditor`
([`code-editor.tsx`](../../../packages/ui/src/modules/files/components/code-editor.tsx))
is the CodeMirror host the sandbox file editor uses, and `FileViewer` is the
precedent for the whole edit-mode shape — Edit / Save / Cancel in the toolbar, a
dirty marker on the title, `Mod-s` to save, a confirm on discard, and a draft that
only resets while edit mode is off. `ArtifactSourceView` is shared by the preview
dialog and the chat docked panel, so making it editable serves both surfaces.

Cross-module imports from `artifacts` into `files` are already established — the
preview dialog imports `FullscreenPreviewDialog` from the files module today.

### Two facts that will bite

- **The two size caps differ.** `getContent` returns text up to `PREVIEW_MAX_BYTES`
  (10 MB) but an inline update accepts `INLINE_CONTENT_MAX_BYTES` (2 MB). Gate
  editability on the smaller cap, or a large text artifact loads into the editor
  and then fails on save.
- **A version publish invalidates the content query.** An artifact update raises a
  domain event that invalidates the whole `artifactLibrary` query path
  ([`invalidation.ts:22`](../../../packages/ui/src/modules/live-events/invalidation.ts)),
  so `getContent` refetches under an open editor. Reset the draft only while edit
  mode is off — the rule `FileViewer` follows.

## Sub-issues

| #  | Title | Scope | Depends on | Done |
|----|-------|-------|------------|------|
| 01 | [Version authorship and the stale-save guard](./01-version-authorship-and-stale-save-guard.md) | Author column and migration; `expectedVersion` on the update contract; the service refuses a stale save; the MCP path attributes to the agent and the tRPC path to the owner | — | ✅ |
| 02 | [Editable source view and the preview dialog](./02-editable-source-view-and-preview-dialog.md) | Editability helper, the `use-artifact-editor` hook, an editable `ArtifactSourceView`, and edit mode in the preview dialog | 01 | ✅ |
| 03 | [Editing from the chat panel and the row menu](./03-editing-from-chat-panel-and-row-menu.md) | Edit mode in the docked panel, an Edit entry in the row overflow menu, and the wiring that opens a preview straight into edit mode | 02 |✅ |
| 04 | [Version history with author and time](./04-version-history-with-author-and-time.md) | A version list showing which version, when, and who wrote it, on both preview surfaces | 01, 02 | |

Order is linear. 04 needs 01's data and 02's surfaces, so it comes last even
though it does not depend on 03.

## Conventions & glossary

**Terms.**

- **Head** — the artifact's current version, the one the share link serves.
- **Author** of a version — `user` when a person wrote it through the app,
  `agent` when a harness published it, null when it predates this feature.
- **Stale save** — a save whose claimed version is no longer the head.
- **Editable artifact** — a text-kind artifact (`html`, `jsx`, `markdown`, `code`,
  `text` — never `binary`) whose head content loaded whole and fits the inline
  update cap.

**Skills to apply.** [`/typescript-engineering`](../../../.claude/skills/typescript-engineering/SKILL.md)
for anything in `packages/api-server`, `packages/api-server-api` or `packages/db`.
[`/react-ui-engineering`](../../../.claude/skills/react-ui-engineering/SKILL.md)
for anything in `packages/ui`. Each sub-issue names the one it needs.

**Conventions.**

- Language rules are indexed in [`docs/guidelines/code/index.md`](../../guidelines/code/index.md).
  Comments follow [`docs/guidelines/comment-guidelines.md`](../../guidelines/comment-guidelines.md)
  — write one only where the code is genuinely hard to reason about.
- Run `mise run` for everything. Never call `go`, `pnpm`, `drizzle-kit` or
  `kubectl` directly.
- No new tests. Verification leans on the existing suite (`mise run test`,
  `mise run check`) plus the manual smoke test in each sub-issue. Existing tests
  that stop compiling because a signature changed are fixed, not replaced.
- One atomic commit per sub-issue.

## Whole-feature smoke test

On the dev cluster (see the [`cluster-ops`](../../../.claude/skills/cluster-ops/SKILL.md)
skill; the dev app is `http://localhost:4444`, plain http):

1. Have an agent publish a markdown artifact, then open **Artifacts** in the rail.
2. Open the artifact. Press **Edit**, change a line, press **Save**. The version
   badge goes from v1 to v2, and the rendered preview shows the new text.
3. Open the version list. v1 and v2 are both listed with a time; v1 says the agent
   wrote it and v2 says you did.
4. Step back to v1. The old text renders and **Edit** is unavailable — only the
   head is editable.
5. Share the artifact and open the share link. It serves the edited text under the
   same URL you copied before the edit.
6. In the chat view, open the artifact in the docked panel, start an edit, and
   leave the draft dirty. Ask the agent to update the same artifact. The draft
   survives; saving it is refused as a conflict and offers to reload.
7. Open a binary artifact (an uploaded image). No **Edit** appears anywhere.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3556.
