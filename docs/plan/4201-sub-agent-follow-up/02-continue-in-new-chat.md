# 02 — Continue in new chat from a finished sub-agent

**Depends on:** 01-runtime-copy
**Part of:** A finished sub-agent cannot be asked follow-up questions — see [README](./README.md)

## Context

The read-only panel of a finished sub-agent gets a **Continue in new chat** button.
It opens a new-chat draft on the root driver that shows the copy (prompt bubble, result bubble) and the divider "Continued from <label>".
The first send creates the session with `continuedFrom`; every load draws the copy and the divider from the load meta, and the first bubble never shows the hidden block.

## Implementation plan

Apply `/react-ui-engineering`.
Paths are under `packages/ui/src/modules/`.

1. **Draft carries the copy.** Add an optional `continuedFrom` (the README contract) to `SessionDraft` in `sessions/lib/draft-key.ts`.
   A draft with `continuedFrom` counts as content: update `setDraft` (`sessions/store/sessions.ts` around :219) and `keysWithDraftContent` (`draft-key.ts`), so the draft is not dropped while its text is empty.
2. **Open action.** Add `invocations/hooks/use-continue-in-new-chat.ts`, modelled on `artifacts/hooks/use-start-artifact-session.ts`: `leaveChatContext` → set the root driver's new-chat draft with `continuedFrom` (built from the `DelegationNode`: `label ?? firstLine(prompt)`, `prompt`, `result` as text with a JSON fallback) → `selectAgent(rootDriverId)`.
   Close the docked delegation panel.
3. **Button.** In `invocations/components/docked-delegation-panel.tsx`, the `finished` footer (around :174) keeps the read-only note and adds a **Continue in new chat** button (Carbon icon, for example `AddComment`).
   The target is the panel's `driverAgentId` (the root driver of the tree).
4. **Draft view.** In `sessions/views/chat-view.tsx`, a new chat whose draft has `continuedFrom` shows the two copied bubbles and the divider instead of the hero (`chatIdle` around :341, hero at :535 and :632).
   Render the bubbles with the existing `ChatMessage` (read-only, the result as the agent bubble with the root driver's avatar).
   A long result folds behind "Show all"; reuse a fold the chat already has if one fits.
5. **Send.** In `sessions/hooks/use-acp-connection.ts` (`session/new` around :219-229), put the draft's `continuedFrom` into `_meta.platform`.
   The user bubble and the first prompt carry only the typed text; the runtime adds the hidden block (slice 01).
6. **Load.** In `runSessionLoad` (`use-acp-connection.ts` around :345-445), read `_meta.platform.continuedFrom` beside `runStarts`, keep it in the session state, and draw the two copied bubbles above the replayed messages.
   When the loaded tail is cut and older pages exist, the copy goes above the oldest page, once.
7. **Divider.** Add a `continued` variant to the thread divider in `sessions/lib/thread-items.ts` (:7, `dividerLabel` :111), placed between the copy and the first real message, with the label "Continued from <label>".
8. **Hide the block.** Add `continued-from` to `PLUMBING_TAGS` in `acp/session-projection.ts` (:31), so a history-provider refill never shows it in the first bubble.
9. **Docs.** In `docs/architecture/invocations.md`, describe the panel action and the follow-up chat it opens.
   Update `Last verified:`.

## Acceptance criteria

- [ ] A finished sub-agent's panel shows **Continue in new chat**; a running sub-agent's panel does not.
- [ ] The click opens a new chat of the root driver with the prompt bubble, the result bubble and the divider "Continued from <label>"; no session appears in the sidebar until the first send.
- [ ] Leaving the draft and coming back keeps the copy; clearing the draft removes it.
- [ ] After the first send, the user bubble shows only the typed text, and the agent's reply uses the sub-agent's work.
- [ ] A reload, a cold reload after an agent pod restart, and an older-page load show the copy and the divider once, above the real conversation.
- [ ] No `<continued-from>` text shows anywhere in the chat.
- [ ] `mise run //packages/ui:test` and `mise run //packages/ui:check` pass.

## Smoke test

1. `mise run //packages/ui:test` and `mise run //packages/ui:check`.
2. Run the README's whole-feature smoke test on the local cluster, with the UI from a local Vite server against the cluster API (start and stop it yourself).

Print a short manual guide for the user with the README's smoke test steps 2–7.
