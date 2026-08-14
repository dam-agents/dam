# Keep a message draft with the session it was written for

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3254

## Goal

A message draft — text and staged attachments — belongs to the session it was written for.
Opening a session puts that session's own draft back in the message box and nothing else; the
draft survives switching sessions, answering an approval, and visiting a terminal session in the
same tab. The draft's **text** also survives a reload and a browser close on the same browser;
staged attachments live for the tab, and opening the session after a reload drops them with a
plain notice toast that names them. The session list marks idle sessions that still hold a
draft. Sending clears the draft; deleting a session deletes its draft.

The issue's Scope was amended on 2026-08-13 (with the author) to the text-only persistence
described above — attachments were originally specced to survive reloads too.

## Approach

Everything lives in `packages/ui`. Nothing is stored server-side; sessions stay agent-owned
over ACP (see [platform-topology](../../architecture/platform-topology.md), §ui).

**Root cause.** The composer
([chat-input.tsx](../../../packages/ui/src/modules/sessions/components/chat-input.tsx)) holds
text and attachments in component-local `useState` (`input` at :40, `attachments` at :41), and
is mounted un-keyed (`views/chat-view.tsx:658`). Session identity is store state
(`sessionId` in the zustand sessions slice), not a route param — so switching sessions never
remounts the composer and its contents follow the user. Conversely, the approval prompt
(`chat-input-area.tsx:43`) and terminal mode (`views/chat-view.tsx:551`) *unmount* it,
destroying the draft.

**The fix.** A session-keyed drafts map in the zustand sessions slice becomes the single owner
of composer state:

- **Key:** `draftKey(agentId, sessionId | null)` — `null` (the blank, not-yet-created chat)
  maps to a per-agent sentinel. Terminal sessions never have drafts (no composer).
- **Slice 01** moves composer state into the map and makes `ChatInput` store-controlled. That
  alone fixes every in-tab loss path.
- **Slice 02** persists `{text, attachmentNames}` per key to localStorage (zod-validated
  snapshot), hydrates at store init, fires the dropped-attachments notice, and prunes stale
  drafts.
- **Slice 03** derives the session-list marker from the same map.

**Attachment shape (why text-only persistence is cheap).** Attachments are staged as
JSON-serializable base64 objects in memory (`packages/ui/src/types.ts:28-49`), up to 50 MB per
file — far past the ~5 MB localStorage quota, which is why blobs stay in memory and only their
names persist. Nothing is uploaded before send (`use-acp-prompt.ts` uploads at send time, keyed
by the final session id), so drafts have no server-side residue.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | ✅ [Session-keyed drafts in memory](./01-drafts-in-memory.md) | Drafts map in the sessions slice; store-controlled composer; clear on send; blank-chat key + promotion migration; delete hook; remove dead `queuedMessage`. | — |
| 02 | [Text persistence and restore notice](./02-text-persistence.md) | zod-validated localStorage snapshot (text + attachment names); hydrate at store init; dropped-attachments toast; list-driven prune; sandbox-delete cleanup. | 01 |
| 03 | [Draft marker in the session list](./03-session-list-marker.md) | Muted pencil icon in the status-dot slot, idle sessions only; driven by the drafts map. | 01 |

03 depends only on 01, so it may land before 02 if convenient; the commit order in this plan is
01 → 02 → 03.

## Conventions & glossary

- **Sandbox** is the user-facing noun; the code says **agent** (`agentId`). Never "fix" either
  side.
- **Blank chat** — the not-yet-created session a user is about to start; store
  `sessionId === null`. One blank-chat draft per agent.
- **Draft exists** iff trimmed text is non-empty **or** staged attachments are non-empty
  (slice 02 adds one more transient case: a pending dropped-attachments notice). Emptying the
  box removes the entry, the marker, and the persisted row.
- **Only the composer's explicit send clears a draft.** Hidden greeting sends
  (knowledge-base/experiment) and per-bubble Retry call `sendPrompt` directly and must never
  touch drafts.
- **Promotion migration** — when the first send promotes a blank chat into a real session
  (`use-acp-connection.ts:238`, `keepAsLive` → `setSessionId`), any draft still under the blank
  key moves to the new session's key. This matches what is visibly in the box at that moment.
- **Prune only on authoritative success.** The ACP session-list poll is passive and fails
  closed when the pod is down — a failed or erroring list must never prune (a hibernated
  sandbox would otherwise wipe its own drafts).
- **Multi-tab** is last-write-wins on the persisted snapshot; no cross-tab sync. Accepted
  limitation.
- Apply the **/react-ui-engineering** skill in every slice. No server-side code is touched, so
  /typescript-engineering does not apply.
- **No new tests.** Verification is `mise run ui:check` + `mise run ui:test` (existing suite)
  plus the manual smoke tests below. The dev app is `http://localhost:4444` (http, not https).

## Whole-feature smoke test

On the local dev cluster, in a sandbox with at least two chat sessions:

1. Type text in session A and attach a file. Switch to session B — the box is empty. Type in
   B. Switch back to A — A's exact text and attachment are back. Both A and B rows show the
   muted pencil marker while idle.
2. Click **New session**, type an opening line, switch to A, come back via New session — the
   blank-chat draft is restored. Send it — a session is created with that prompt and the draft
   is gone.
3. In a session with a draft, trigger a tool approval, answer it — the composer returns with
   the draft intact. Open a terminal session and come back — same.
4. Send A's draft — it delivers to A, the box and A's marker clear.
5. With text + an attachment staged, reload the page and reopen the session — the text is
   restored, one info toast names the dropped attachment, send works normally.
6. Delete a session that holds a draft — its draft and marker are gone (also from
   localStorage, key `platform-drafts`).
7. While a session is working, waiting on approval, or running background work, its row shows
   those markers, never the pencil.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3254.
