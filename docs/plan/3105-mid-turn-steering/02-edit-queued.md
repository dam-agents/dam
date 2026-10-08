# 02 — Edit and delete a queued message

**Depends on:** 01-shared-queue
**Part of:** Mid-turn steering and message correction — see [README](./README.md)

## Context

With the queue visible (01), a user can fix a message before the agent reads it: change its text
or remove it. A queued item is editable until it starts; after that the runtime refuses the
change and the UI says so. Web UI only.

## Implementation plan

Apply `/typescript-engineering` (runtime, contract) and `/react-ui-engineering` (UI).

1. **Contract** — `types.ts`: `platformUpdateQueuedParamsSchema`, `platformRemoveQueuedParamsSchema`,
   `PROMPT_NOT_QUEUED_CODE`.
2. **Scheduler** — `prompt-scheduler.ts`: `update(sessionId, promptId, prompt): boolean` replaces
   the queued submission's blocks **and** its outbound frame's `params.prompt`;
   `remove(sessionId, promptId): PromptSubmission | null` takes it out. Both fire `onQueueChanged`.
   Only entries with a `promptId` match; the active turn never matches.
3. **Runtime** — `acp-runtime.ts`, next to the other `platform/*` methods:
   - `platform/updateQueued` / `platform/removeQueued` → scheduler; on miss, error
     `{ code: -32000, message: "prompt is no longer queued", data: { code: PROMPT_NOT_QUEUED_CODE } }`.
   - A removed prompt's original `session/prompt` request must still get an answer, or its sender
     waits forever: reply to the sender with a result `{ stopReason: "cancelled" }` and clean
     `outboundIdToClient`.
   - Only the session's engaged channels may edit (any tab of the owner; the relay already
     authorizes the socket).
4. **UI** — `packages/ui/src/modules/sessions/api/acp-session-ops.ts`: `updateQueuedPrompt`,
   `removeQueuedPrompt`. On a queued bubble (`chat-message.tsx`) add Edit and Delete actions
   (Carbon `Edit`, `TrashCan`). Edit swaps the bubble into an inline editor (reuse the composer's
   text area behavior: Enter saves, Escape cancels). Images in a queued prompt are kept; only text
   blocks are edited. A `PROMPT_NOT_QUEUED` answer shows "Already sent — it can no longer be
   changed." and closes the editor.
5. **Docs** — `agent-lifecycle.md` "Prompt delivery": a queued prompt can be changed or removed
   until it starts.

## Acceptance criteria

- [ ] Editing a queued message changes the text the agent receives when it starts.
- [ ] Deleting a queued message removes it in every tab; the agent never sees it.
- [ ] Editing or deleting a message that started meanwhile shows the "Already sent" notice and
      changes nothing.
- [ ] The sender of a removed prompt gets no error toast and no stuck spinner.
- [ ] Package tests pass (agent-runtime, ui, api-server-api).

## Smoke test

On a Codex or Bob agent, two tabs on one session: send a slow task, then "alpha" and "beta". In
tab B edit "alpha" to "gamma"; in tab A delete "beta". Both tabs show one queued "gamma". When the
task ends, the agent answers "gamma". Try to edit while the item starts: the notice shows.
