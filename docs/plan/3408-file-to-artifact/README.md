# A file the agent made becomes an artifact you can share

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3408
**Designs:** `/Users/pett/Downloads/Figma/file-to-artifacts` (DAM.png — the file panel with
"Create artifact"; DAM-1.png — the artifact panel after promoting, public, "Copy link";
DAM-2.png — the same, private, "Share")

## Goal

A user looking at a file in the chat dock turns it into an artifact without leaving the panel,
and shares it from where they land. The artifact remembers which file it came from: promoting
the same file again publishes a new version to the same share link instead of minting a second
artifact, so the file/artifact distinction stops mattering at the moment of sharing.

## Approach

See [artifact-library](../../architecture/artifact-library.md). Three facts shape the design:

- **The client already holds the bytes.** The docked file panel reads content over the pod's
  own tRPC (`clientFor(agentId).files.read`,
  `packages/ui/src/modules/files/api/queries.ts`), so promotion is a browser-side call to the
  artifact procedures that already exist — `artifactLibrary.create` for the first promote,
  `artifactLibrary.update` for a sync — with the staging-upload path
  (`createUploadUrl`) available for content past the inline cap. No new pod↔server surface.
- **The link is one nullable column.** `library_artifacts.source_path`, stored by the create
  and update procedures when their input carries `sourcePath`, and returned on
  `LibraryArtifact`. The agent's MCP tools (`create_artifact`, `update_artifact`) gain the same
  optional field, so agent publishes can link too.
- **The linked-artifact lookup is a scan, not a query.** The chat sidebar already fetches the
  agent's artifact list; "does this file have an artifact" is a filter over it.

### Decided semantics (settled with the author — do not relitigate)

- The link means **came from**, not **is bound to**. A renamed or deleted source file leaves
  the artifact's `sourcePath` stale; nothing verifies the file still exists.
- **Sync updates content only.** Title, visibility, and folder are the artifact's own and
  survive a re-promote. The share link stays the same; viewers can flip versions.
- Two artifacts claiming the same path: the button syncs the **most recently updated** one.
  No disambiguation UI.
- A deleted artifact breaks the link permanently: the next promote creates a fresh artifact
  with a fresh share link.
- `sourcePath` is a **label**, never authorization and never dereferenced server-side. From
  the MCP tool it is model-supplied and trusted only as a label on the agent's own artifacts —
  the same trust shape as the artifact-touch marker.

### Known limits (state, don't fix)

- The panel cannot read binary or oversize files (`files.read` refuses with
  `PAYLOAD_TOO_LARGE`); for those the promote button is disabled with a tooltip. The agent-side
  tool covers big files.
- Existing artifacts have no recorded origin and cannot be backfilled; they gain the link the
  first time they are synced-over or republished with a path.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 ✅ | The source link in the contract | `source_path` column + migration, `sourcePath` through create/update inputs and `LibraryArtifact`, optional `source_path` on the two MCP tools | — |
| 02 | Promote from the file panel | The Create artifact / Sync to artifact button, the panel switching to the artifact view on success, and the toolbar typography unification | 01 |

The icon beside artifact titles in the designs is the app's existing shared-artifact
indicator, not a new file-link glyph — no sidebar change ships with this feature.

## Conventions & glossary

- **Promote** — the user turning a file into an artifact from the panel. **Sync** — promoting
  a file whose artifact already exists, publishing a new version.
- **Linked artifact** — an artifact whose `sourcePath` is set.
- Apply `/typescript-engineering` for `packages/api-server`, `packages/api-server-api` and
  `packages/db`; `/react-ui-engineering` for `packages/ui`.
- Migrations are generated (`mise run db:generate`), never hand-written. Never invoke `pnpm`,
  `tsc`, `drizzle-kit` or `eslint` directly — `mise run` only.
- Toolbar typography target, from the designs and the chat file toolbar: **14px, weight 400**
  — the Button `sm` variant (`text-sm font-normal`), not `xs` (`text-xs font-medium`).

## Whole-feature smoke test

On a cluster, in an agent's chat: open a text file the agent made in the dock. Promote it —
the panel becomes the artifact view with Share; share it and copy the link. The sidebar's
Artifacts section shows the new artifact. Ask
the agent to edit the file, reopen it, and the button reads "Sync to artifact"; sync, and the
share page shows v2 of 2 under the same URL. Open a binary file and confirm the button is
disabled with a reason. Rename the artifact, sync again, and the title survives.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
[#3408](https://github.com/dam-agents/dam/issues/3408).
