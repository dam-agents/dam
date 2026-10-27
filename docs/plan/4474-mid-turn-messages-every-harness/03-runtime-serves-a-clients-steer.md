# 03 — The runtime serves a client's steer

**Depends on:** 01-clients-see-whether-a-session-steers
**Part of:** Mid-turn messages reach the agent on every harness — see [README](./README.md)

## Context

Today a client's `_session/steering` request passes through the runtime to the harness unchanged, outside the prompt scheduler.
So a channel steer skips steer points, can join any turn, and cannot reach a harness that steers by interrupt.
This slice makes the runtime serve the request itself, as a **steer-only entry** in the prompt scheduler, under the contract in the README.
A steer-only entry joins only its target turn, is idempotent by its `promptId`, and has one rule for every way out of the queue: `injected`, or `promptRequired`.
The api-server switches to it in 04; until then, this slice is verified with an ACP client script.

## Implementation plan

Apply `/typescript-engineering`.
Read [sessions](../../architecture/sessions.md) "Prompt delivery" first.

1. **Contract.**
   In [`packages/api-server-api/src/modules/acp/types.ts`](../../../packages/api-server-api/src/modules/acp/types.ts), add `reason` to `steerResponseSchema`, and add a schema for the request's `_meta.platform` (`promptId`, `targetPromptId`).

2. **Relay stamp.**
   In [`sender-stamp.ts`](../../../packages/api-server/src/apps/api-server/agent-proxies/sender-stamp.ts), add `STEER_METHOD` to `SENT_BY_A_PERSON`, so that the relay writes the signed-in person as sender and replaces anything the client wrote.
   Without this, a client could name any sender for a steer.
   Check how the channel worker's connection reaches the runtime, and that its steers carry the same sender as its prompts.

3. **Router short-cut.**
   In [`lease-router.ts`](../../../packages/agent-runtime/src/modules/acp/services/lease-router.ts) `route()`, answer a `STEER_METHOD` request with `promptRequired` (`noRunningTurn`) when the session runs on no lease (`!isSessionRunning`), so that a steer never starts a harness.
   Add `servesSteering: true` to `_meta.platform` of the router's own `initialize` answer, beside `runEnded`.

4. **Steer-only entries in the scheduler.**
   In [`prompt-scheduler.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime/prompt-scheduler.ts), add a steer-only kind of `PromptSubmission` with its `targetPromptId` and an answer callback.
   - **Order.** It queues in arrival order behind what is already queued, and counts toward the queue cap.
   - **Target.** It is steered only while the session's active turn is its target.
     While the target prompt is still queued or starting, it waits behind it; when the target turn has ended or never ran, it is answered `promptRequired` (`notYourTurn`).
   - **Batches.** It can share a batch with ordinary steerable prompts; settle answers each member by its kind.
   - **Snapshot.** It shows in the queue snapshot with its sender and `editable: false`.
   - **One disposal rule.** Every way out of the queue other than `injected` answers it `promptRequired`, and none enqueues it as ordinary, records it as undelivered, or adds it to the turn's `steered` list.
     Apply the rule in each place: `settleSteer("refused")`; `onPromptResponse` and `onSettingResponse` before `maybeStartNext`; `forget`, `clear`, `dropQueue` (park expiry, session forgotten, scheduler cleared) and `refuseQueue`.
   - **Answer at once.** When it is steered and the harness took it, answer `injected` at once, not at turn end; `onSteered` writes the echo to the log as for a typed prompt, but sends it no turn answer.
     When the turn ended during the harness round trip (`joinTurn` with no active turn), answer `promptRequired`.
   - **Withdraw.** Add `withdraw(channel)`, which removes that channel's queued steer-only entries without an answer.
     An entry already sent to the harness is never withdrawn; it is always answered.

5. **Serve the request.**
   In [`acp-runtime.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts), handle a client request with `STEER_METHOD`, beside `platform/steerQueued`.
   - Parse it; answer `-32602` on invalid params.
   - When the session runs no turn and has no queued or starting target prompt, answer `promptRequired` (`noRunningTurn`); check this before the harness's ability.
   - When the session cannot steer, answer error `-32601`.
   - Look up `promptId` in a bounded per-session record of answered steers; a known id gets its first answer again, and nothing else happens.
   - Otherwise submit a steer-only entry with the prompt blocks, the stamped sender, the channel and the target.
   - Never forward a client's `_session/steering` to the harness.
     The runtime's own outbound steer (`steerIntoTurn`) stays.
   - Call `promptScheduler.withdraw(channel)` from `detach(channel)` for every channel, including one that engaged no session.

6. **Docs.**
   In [`sessions.md`](../../architecture/sessions.md) "Prompt delivery", describe the served steer: its target turn, its idempotency, that it never starts a turn and is never recorded as undelivered, and that queued prompts belong to the conversation except steer-only entries, which belong to their sender.
   Say that a steer is stamped with its sender like a prompt, here and in [`agent-editors.md`](../../architecture/agent-editors.md), which lists what the relay stamps.
   Update **Last verified** on both.

## Acceptance criteria

- [x] A steer whose target turn runs is answered `injected` at the next steer point, and its text shows in the session's log as a steered message.
- [x] A steer whose target prompt is still queued waits, and joins that turn when it runs.
- [x] A steer whose target turn has ended, or that names another turn, is answered `promptRequired`, and the agent never receives it.
- [x] A steer repeated with the same `promptId` gets the same answer and reaches the agent once.
- [x] A steer whose connection closes while it waits is never delivered.
- [x] A steer on a session that runs on no lease is answered `promptRequired` and starts no harness.
- [x] A steer that carries a forged `_meta.platform.sender` is recorded with the signed-in person.
- [x] A steer on a running Bob session is answered with error `-32601`.
- [x] `mise run check` and `mise run test` pass for `agent-runtime`, `api-server-api` and `api-server`.

## Smoke test

1. `mise run cluster:build -- api-server agents`.
2. With an ACP client script, open a session on Claude Code with a `promptId`, and send a prompt that runs `sleep 30; echo ALPHA` and then `sleep 30; echo BRAVO`, one at a time.
3. From a second connection, during the first command, send `_session/steering` with a short question and `targetPromptId` set to that `promptId`.
   Expect `injected` when the command ends, and an answer to the question in the same turn.
4. Send the same steer again with the same `promptId`, and expect `injected` again and no second delivery.
5. Send a steer with another `targetPromptId`, and expect `promptRequired`.
6. Repeat step 3 on a Bob session, and expect error `-32601`.

Then print a short manual guide so that the user can repeat steps 2 to 4.
