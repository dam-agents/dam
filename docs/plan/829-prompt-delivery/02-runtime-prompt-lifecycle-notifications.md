# 02 — Runtime: prompt lifecycle notifications

**Depends on:** 01-adr-server-authoritative-prompt-delivery
**Part of:** Honest prompt delivery feedback — see [README](./README.md)

## Context

The runtime knows a prompt's fate frame by frame — accepted (queued or direct), handed to
the agent — but tells the sender nothing until the turn's JSON-RPC response, which for a
queued prompt arrives after the prior turn plus its own. This slice makes the runtime emit
the two lifecycle notifications pinned in the README. Apply `/typescript-engineering`.

## Implementation plan

1. **Schemas and builders** — `packages/api-server-api/src/modules/acp/types.ts`, next to
   the `platformTurnEnded*` block and following it exactly:
   - `platformPromptAcceptedParamsSchema` = `{ sessionId: z.string().min(1), promptId: z.string().min(1), queued: z.boolean() }`;
     notification schema with `method: z.literal("platform/promptAccepted")`;
     `buildPlatformPromptAcceptedNotification`.
   - `platformPromptStartedParamsSchema` = `{ sessionId, promptId }`; method
     `platform/promptStarted`; `buildPlatformPromptStartedNotification`.
   - Export all of it from `packages/api-server-api/src/index.ts` beside the turnEnded
     exports (~line 440).
2. **Extract the promptId** — `packages/agent-runtime/src/modules/acp/services/acp-runtime.ts`:
   - Add `extractPromptId(frame): string | null` reading `params._meta.platform.promptId`
     (reuse `isNonNullObject`, mirror `extractPlatformMeta` at ~line 1465).
   - In the client-request handler (~line 1282), currently `extractPlatformMeta`/
     `stripPlatformMeta` run only for `session/new`. For `session/prompt`, extract the
     promptId and strip the `platform` meta key from the forwarded frame the same way —
     the agent must never see it.
3. **Thread promptId through the prompt path**: add `promptId: string | null` to the entry
   objects pushed into `promptQueueBySession` (~line 1343) and passed to
   `forwardPromptToAgent` (~line 1352), and to that function's parameter type (~line 854).
4. **Emit `platform/promptAccepted`** in the `promptSessionId !== null` branch, only when
   `promptId` is non-null:
   - queued path: after the successful `queue.push` (never on the queue-full rejection —
     the error response already covers it);
   - direct path: alongside the `forwardPromptToAgent` call.
   Send with `sendToChannel(channel, JSON.stringify(buildPlatformPromptAcceptedNotification({...})))`
   — sender-only, and deliberately **not** `appendAndFanOut`: these frames must never enter
   the session log.
5. **Emit `platform/promptStarted`** inside `forwardPromptToAgent`, after `a.send(entry.frame)`,
   when `entry.promptId` is non-null — `sendToChannel(entry.channel, ...)` (it already
   no-ops on a closed channel). This fires for both direct sends and queue promotions from
   `advanceQueue`.
6. **Fix the stale comment** at ~lines 1316-1321: it claims the user-chunk echo fans out
   "to everyone including the sender" and that the sender reconciles it; the code passes
   `skipChannel: originator` (`appendUserPromptToLog`, ~line 526). Align the comment with
   the code.
7. **Tests** — flagged exception to the no-new-tests default (frame emission has no manual
   smoke path until the UI slices land). Extend
   `packages/agent-runtime/src/__tests__/unit/acp-runtime.test.ts`:
   - direct prompt with promptId → sender receives `promptAccepted{queued:false}` then
     `promptStarted`;
   - prompt sent while a turn is active → `promptAccepted{queued:true}` immediately, no
     `promptStarted` until the prior turn's response arrives, then `promptStarted`;
   - prompt without promptId → neither notification;
   - the notifications never appear in a later `session/load` replay;
   - the forwarded prompt frame reaching the agent carries no `_meta.platform`.

## Acceptance criteria

- [ ] Both notifications reach only the originating channel, at the moments defined above.
- [ ] Queue-full rejection emits no `promptAccepted`.
- [ ] Prompts without a promptId produce no notifications and are otherwise unaffected.
- [ ] The agent never receives `_meta.platform` on forwarded prompt frames.
- [ ] The notifications are absent from session logs and replays.
- [ ] The stale echo comment matches the code.

## Smoke test

`mise run agent-runtime:test && mise run agent-runtime:check && mise run api-server-api:check`
— all green, including the new test cases from step 7.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
