# 01 — Session-keyed drafts in memory

**Part of:** Keep a message draft with the session it was written for — see [README](./README.md)

## Context

Move the composer's text and attachments out of component-local `useState` into a
session-keyed drafts map in the zustand sessions slice, and make `ChatInput` store-controlled.
This one change fixes every in-tab loss path: drafts stop following the user across sessions,
survive the approval prompt unmounting the composer, and survive terminal round-trips. Apply
the **/react-ui-engineering** skill throughout.

## Implementation plan

1. **Key helper** — new pure module
   `packages/ui/src/modules/sessions/lib/draft-key.ts` (keep it free of store/DOM imports, like
   `lib/session-path.ts`, so node-env tests could import it):
   - `draftKey(agentId: string, sessionId: string | null): string` — sentinel for
     `null` (blank chat), e.g. `` `${agentId}:${sessionId ?? "~new"}` ``.
   - `draftHasContent(d): boolean` — trimmed text non-empty or attachments non-empty.

2. **Drafts map in the sessions slice** —
   `packages/ui/src/modules/sessions/store/sessions.ts` (slice interface at :22-46):
   - State: `drafts: Record<string, SessionDraft>` where
     `SessionDraft = { text: string; attachments: Attachment[] }` (`Attachment` from
     `packages/ui/src/types.ts:44-49`). Mirrors the per-key `Record` idiom of
     `modules/files/store.ts` (`expandedDirs`, `importingAgents`).
   - Actions:
     - `setDraft(key, patch)` — merge; if the result has no content
       (`draftHasContent` false), delete the entry instead of storing an empty one.
     - `clearDraft(key)` — delete the entry.
     - `migrateDraft(fromKey, toKey)` — move an entry if present and non-empty; no-op
       otherwise (must be idempotent).
   - `resetChatContext` (:82-96) must **not** clear drafts — it fires on agent switch,
     back-navigation, and popstate, and drafts deliberately survive all of those.
   - Remove the dead `queuedMessage` / `setQueuedMessage` state (:28, :40, :59, :79, cleared
     at :94). Grep first to confirm it is still reader-less; it is vestigial state this slice
     replaces.

3. **Store-controlled composer** —
   `packages/ui/src/modules/sessions/components/chat-input.tsx`:
   - Derive the current key inside the component from the store: agent id (agents slice,
     `modules/agents/store.ts` `selectedAgent`) + `sessionId` (sessions slice). Do not add
     props for this — `ChatInputArea` and `ChatView` stay unchanged apart from what step 5
     needs.
   - Replace `const [input, setInput] = useState("")` (:40) and `attachments` (:41) with
     reads of `drafts[key]` (default empty draft) and writes through `setDraft(key, …)`.
     Keep `dragOver` and the file-input ref local — they are ephemeral UI state, not draft.
   - `send()` (:125-132): keep the optimistic clear, now `clearDraft(key)` before `onSend`.
     Failed sends keep recovering via the per-bubble Retry (`retryWith`), which never touches
     the composer — unchanged behavior.
   - `useAutoResize(textareaRef, input)` (:45) keeps working — the value now comes from the
     store; the parent-owned `textareaRef` (`views/chat-view.tsx:183`) is unaffected.
   - `addFiles` (:47-81) writes staged results through `setDraft` instead of
     `setAttachments`.

4. **Delete hook** — `deleteSession` in
   `packages/ui/src/modules/sessions/store/sessions.ts:98-116`: after
   `removeSessionFromCache`, call `clearDraft(draftKey(agentId, sessionId))`.

5. **Promotion migration** — in `keepAsLive`,
   `packages/ui/src/modules/sessions/hooks/use-acp-connection.ts:134-152`, next to the
   `setSessionId(startedSessionId)` call at :148: migrate
   `draftKey(agentId, null)` → `draftKey(agentId, startedSessionId)`. The user's send already
   cleared the blank draft, so this only carries text typed while the first send was in
   flight — without it, the store-controlled box would visibly blank out at the key change.
   This also does the right thing when a hidden greeting send (knowledge-base/experiment)
   promotes a blank chat under a draft the user is typing.

## Acceptance criteria

- [ ] Type in session A (text + attachment), switch to B: box is empty. Switch back to A:
      exact text and attachment restored.
- [ ] Blank chat: type without sending, open an existing session, click New session — the
      blank draft is restored. It never appears inside an existing session.
- [ ] Approval prompt replaces the composer and is answered — draft intact afterwards.
- [ ] Chat → terminal session → back to chat — draft intact.
- [ ] Sending clears only the sent session's draft; a failed send does not repopulate the box
      (Retry lives on the bubble, unchanged).
- [ ] A knowledge-base greeting neither consumes nor clears a draft; typed text visibly
      survives the blank-chat → session promotion.
- [ ] `queuedMessage` is gone from the slice with no references left.
- [ ] `mise run ui:check` and `mise run ui:test` pass.

## Smoke test

`mise run ui:check && mise run ui:test`, then manually on the dev cluster
(`http://localhost:4444`): walk steps 1–3 of the README's whole-feature smoke test (session
switch, blank chat, approval + terminal round-trip). Reload behavior is out of scope until 02 —
after a reload the box is empty, which is expected at this slice.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
