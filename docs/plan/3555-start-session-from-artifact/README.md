# Start a new session from an artifact

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3555

## Goal

A user who is looking at an artifact can keep working on it in one click. The
click opens a new session on the Agent that published the artifact, and the
composer already holds a reference to that artifact. Nothing runs: the user
reads the pre-filled line, edits it, and presses send.

Today an artifact is a dead end. To iterate on one, the user must remember
which Agent made it, open that Agent, start a session, and describe the
artifact again from memory. Most users do not, so the artifact stays as it is.

## Approach

The feature is UI only. No tRPC procedure changes, no schema changes, and no
new server route. It composes three mechanisms that already exist, and adds one
sentence to an agent-facing tool description.

### The reference

The prefill is one line: `<artifact title> — platform://artifacts/<id>`.

`platform://artifacts/<id>` is the platform's own artifact reference, built by
`artifactInternalLink()` in
[`api-server-api`](../../../packages/api-server-api/src/modules/artifact-library/types.ts).
Every artifact an Agent sees over its MCP server already carries it as
`internal_link`, and the id inside it is exactly what the `get_artifact` and
`update_artifact` tools take. The title comes first so that a person can read
the line.

Two constraints settled this, and the implementing agent should not revisit
them:

- **A share URL cannot carry it.** A private artifact has no share link at
  all — the library mints one only for public and restricted visibility.
- **The design draws the reference as an underlined URL, and that underline is
  out of reach.** The composer is a plain textarea, and a user message renders
  as plain text — only Agent text goes through the markdown pipeline. So the
  reference is plain text in the composer and in the transcript. Do not build a
  rich composer or a chip renderer for this issue.

### The prefill

The composer reads its text from the per-Agent draft store, under the key for
that Agent's blank new chat. Navigating to a chat resets the chat context but
does **not** clear drafts, so writing the draft and then navigating leaves the
text in the box.

Drafts survive a reload, so the reference is **appended** after any unsent text
the user already had for that Agent. It never replaces it.

### The navigation

Opening an Agent's chat resets to a blank session and auto-wakes a stopped
Agent, so a stopped creating Agent needs no handling of its own. The artifact
tools are registered for every Agent, so a knowledge base can own an artifact —
those route through the knowledge-base chat view instead. On mobile the action
lands on the chat screen rather than the session list; otherwise the pre-filled
box would be off screen.

### Where the action appears

Four surfaces, three components:

| Surface | Component | Affordance |
|---|---|---|
| Artifacts page row, the Agent's artifacts section, the chat sidebar list | `artifact-row-menu-items.tsx` — shared by all three | menu item, after Download and above the separator |
| Artifact preview dialog | `artifact-preview-dialog.tsx` | primary footer button, rightmost |
| Docked artifact panel, beside a chat | `docked-artifact-panel.tsx` | icon button with a tooltip, next to Download |

### When the action is hidden

- **The artifact has no creating Agent** (`agentId` is null — a user upload).
  The issue puts uploads out of scope.
- **The creating Agent is not in the Agent list** — deleted, or not readable.
  The list is empty while it loads, so the action appears once the list arrives.
- **In the two previews only: an older version is displayed, or the source
  editor is open.** `Edit` is already head-only in both previews, and the
  reference always means the current version. Hiding it while editing also
  removes the one path that could discard an unsaved artifact edit, because a
  dirty editor implies an open editor. The menu item has no version context and
  no editor, so it stays.

### Architecture doc

[`docs/architecture/artifact-library.md`](../../architecture/artifact-library.md)
owns artifact attribution, so it gains the continuation path in the same commit,
with its `Last verified` date bumped. The page is far under its character cap.
Composer drafts are browser-local UI state and have no architecture page.

## Conventions & glossary

- **Artifact reference** — `platform://artifacts/<id>`. An internal name for an
  artifact, not a URL a browser can open.
- **Head version** — the artifact's current version. An Agent's revision always
  appends on top of head, whatever version a viewer has on screen.
- Apply the **`/react-ui-engineering`** skill to every file under
  `packages/ui`. State lineage matters here: the draft is UI state in the
  Zustand store, the Agent list is server state from TanStack Query. Neither is
  copied into the other.
- Code carries no prose comments. Any comment must use a registered type inside
  a `/** */` block, per
  [`docs/guidelines/comment-guidelines.md`](../../guidelines/comment-guidelines.md).
  Run `mise run check:comment-types` after the code changes.
- **No new tests.** Verification uses the existing suites plus a manual smoke
  test.

## Whole-feature smoke test

The feature is a single sub-issue, so its smoke test is the feature's — see
[01](./01-start-session-from-artifact.md#smoke-test). In short: on the dev
cluster, take an artifact an Agent published, start a session from each of the
three affordances, and confirm the composer holds
`<title> — platform://artifacts/<id>` on the creating Agent's blank chat with
nothing sent. Then send it once and confirm the Agent reads the artifact back.

## Delivery

One sub-issue, one atomic commit, landing as a single PR for
[issue #3555](https://github.com/dam-agents/dam/issues/3555). A later commit
deletes `docs/plan/3555-start-session-from-artifact/` to clear the
`Plan check` gate.
