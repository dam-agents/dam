# 02 — Text persistence and restore notice

**Depends on:** [01-drafts-in-memory](./01-drafts-in-memory.md)
**Part of:** Keep a message draft with the session it was written for — see [README](./README.md)

## Context

Persist each draft's text (plus the *names* of its staged attachments — never the blobs) to
localStorage, hydrate the drafts map at store init, tell the user once which attachments a
reload dropped, and prune drafts whose sessions no longer exist. Apply the
**/react-ui-engineering** skill.

## Implementation plan

1. **Snapshot module** — new
   `packages/ui/src/modules/sessions/lib/draft-snapshot.ts`, modeled on the two existing
   patterns: zod-validated versioned blob like
   `modules/sandboxes/lib/wizard-snapshot.ts` (schema with `.default()`s, discard + `console.warn`
   on parse failure like `modules/platform/store/theme.ts:24-41`), and an injectable storage
   interface like `lib/return-path.ts` (`ReturnPathStore`) so the module stays testable without
   a DOM.
   - Key: `platform-drafts` (existing `platform-*` convention). Storage: `localStorage` —
     `sessionStorage` dies with the tab and cannot satisfy "survives a browser close".
   - Shape: `{ version: 1, drafts: Record<string, { text: string; attachmentNames: string[] }> }`,
     keyed by the same `draftKey` strings as the in-memory map.
   - `loadDraftSnapshot()` / `saveDraftSnapshot(drafts)`. Save derives the persisted row from
     an in-memory `SessionDraft`: `text` as-is, `attachmentNames` from each attachment's
     `name`, falling back to `"image"` for pasted `ImagePart`s (they carry no name —
     `packages/ui/src/types.ts:28-33`).

2. **Write-through** — call `saveDraftSnapshot` synchronously from every slice action that
   mutates `drafts` (`setDraft`, `clearDraft`, `migrateDraft`, the delete hook, and this
   slice's prune). No debounce and no `beforeunload` flush: the snapshot is a few KB of text,
   localStorage writes are synchronous, and writing on every mutation means nothing can be
   lost to a timer. If profiling ever disagrees, debouncing is a contained follow-up.

3. **Hydration** — the sessions slice initializer reads the snapshot (synchronously, the
   `theme.ts` pattern) and seeds `drafts`. A hydrated entry becomes
   `{ text, attachments: [], droppedAttachmentNames }` — extend `SessionDraft` with optional
   `droppedAttachmentNames?: string[]`, present only between hydration and the first time that
   session is opened. `draftHasContent` stays as defined in 01 (text or attachments); an entry
   with *only* `droppedAttachmentNames` is kept solely to deliver the notice, and never shows
   a marker.

4. **Restore notice** — in the composer (the surface that shows the restored draft): when the
   current key's draft carries `droppedAttachmentNames`, fire one toast via `emitToast`
   (`packages/ui/src/lib/toast.ts:54-60`) —
   `{ kind: "info", message: "Draft restored without N attachment(s): <names>" }` — then strip
   `droppedAttachmentNames` from the entry (deleting the entry if nothing else remains) so the
   notice cannot re-fire. Wording per issue: a plain notice, never an error state, never a
   blocked send.

5. **List-driven prune** — where the ACP session list resolves successfully
   (`useAcpSessions`, `packages/ui/src/modules/sessions/api/queries.ts:87-124`): drop every
   draft of that `agentId` whose session id the list does not contain. Rules:
   - Prune on the **raw** `listAgentSessions` result, before the queryFn's `include` type
     filter — the raw list is the full superset, so a filtered variant can never prune valid
     drafts.
   - Never prune the blank-chat key.
   - Never prune the **active session's** key. The queryFn re-inserts a stub when the backend
     list does not yet contain the active session (`queries.ts:109-116`) — a freshly promoted
     session can lag the authoritative list by a poll cycle, and its draft must survive that
     window.
   - Prune only from a **successful** response — the passive list fails closed when the pod is
     down (hibernation must never wipe drafts). An empty successful list is authoritative.
6. **Sandbox deletion** — in the agent-delete mutation the chat view uses
   (`useDeleteAgent`, wired at `views/chat-view.tsx:197`): on success, clear all drafts for
   that `agentId`, including the blank-chat key.

## Acceptance criteria

- [ ] Reload mid-draft: opening that session restores its text; the blank-chat draft restores
      too.
- [ ] Draft with text + attachments, reload, open the session: text intact, one info toast
      names the dropped attachments, send works; reopening shows no second toast.
- [ ] Attachments-only draft, reload, open: the toast fires once, then the entry is gone — no
      ghost draft.
- [ ] Deleting the session from a second tab: within one poll cycle this tab's draft is
      pruned from memory and localStorage.
- [ ] A hibernated sandbox (session list failing closed) does not lose its drafts.
- [ ] A corrupt `platform-drafts` value is discarded with a console warning and the app boots
      clean.
- [ ] `mise run ui:check` and `mise run ui:test` pass.

## Smoke test

`mise run ui:check && mise run ui:test`, then manually on the dev cluster
(`http://localhost:4444`): README whole-feature smoke steps 5–6 (reload with attachment →
named toast; delete a drafted session → localStorage row gone, inspect
`localStorage["platform-drafts"]` in devtools). For the hibernation rule: stop the sandbox,
reload, confirm drafts survive while the session list shows the pod down.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
