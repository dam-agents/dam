# 04 — Slack and Telegram steer through the runtime

**Depends on:** 02-pi-steers-codex-no-hidden-turn, 03-runtime-serves-a-clients-steer
**Part of:** Mid-turn messages reach the agent on every harness — see [README](./README.md)

## Context

The channel queue steers a follow-up into the running turn with `_session/steering`, but only after it reads a steering flag from `initialize`, which has been missing since 2026-10-15.
After 03 the runtime serves the request itself: it can hold a steer until the next steer point, which takes up to a minute on a native harness and as long as a command runs on an interrupt harness.
The channel queue was built for a steer that answers within 30 seconds, and several of its rules then deliver a message twice: it sends a batch again after a late `injected`, its thread supersede cannot see a held steer, and a 30-second deadline would cut native steers.
This slice moves the channel queue to the new request and fixes those rules.
The answer to a follow-up that lands after the agent's reply comes in 05.

## Implementation plan

Apply `/typescript-engineering`.
Read [channel turns](../../architecture/channel-turns.md) "Inbound" and "The turn watch" first.

1. **Know the target.**
   The channel's `session/prompt` for a turn carries a sender-minted `_meta.platform.promptId`, so that a steer can name that turn as its target.
   Find where Slack and Telegram send the turn's prompt ([`acp-client.ts`](../../../packages/api-server/src/core/acp-client.ts) `sendPrompt` and `promptPinningDefault`).

2. **Steer request.**
   In `acp-client.ts`, change `steer()`:
   - Steer only when the router's `initialize` answer has `_meta.platform.servesSteering`; otherwise answer `"unsupported"`.
     An older runtime forwards a steer raw to the harness, which on an unpatched Codex starts a hidden turn.
   - Send `promptId` (one id per batch, kept with the batch) and `targetPromptId` (the running channel turn's id).
   - Map the answers: `injected` → `"injected"`; `promptRequired` → `"no-running-turn"`; error `-32601` → `"unsupported"`; anything else → `"failed"`.
   - Remove the 30-second `STEER_CEILING_MS` deadline.
     Take an `AbortSignal` instead, and keep the connection's liveness checks.

3. **Channel queue.**
   In [`conversation-queue.ts`](../../../packages/api-server/src/modules/channels/infrastructure/conversation-queue.ts):
   - Abort a held steer a short grace time (about 15 s) after its target turn's `runTurn` ends.
     The runtime then withdraws it if it still waits, or answers it if it is already out.
   - When a steer's connection fails before an answer, send the same steer again, with the same `promptId`, before you treat the batch as not steered; the runtime answers a known id with its first answer.
   - Never put a batch back into `pending` after an `injected` answer, even when `turnEpoch` changed: the message is already in a turn.
     Hand its refs to that turn's delivery watch instead.
     Change the existing test that runs such a batch again (`conversation-queue.test.ts`, the case near line 297) on purpose.
   - Make a turn's delivery verdict only after any steer still out for that turn has its answer.

4. **Thread supersede sees a held steer.**
   In [`slack.ts`](../../../packages/api-server/src/modules/channels/infrastructure/slack.ts), the running turn's `carries()` lists the batch and `steeredRefs` ([`thread-supersede.ts`](../../../packages/api-server/src/modules/channels/domain/thread-supersede.ts)).
   Add the batch of a held steer, which the queue exposes.
   When supersede claims a message of a held steer, abort that steer; the batch comes back, and `runTurn` filters it as today.

5. **Audit.**
   Give the Slack steer's `channel.authz` record the `senderDetail` that a turn's record has, and give a Telegram steer a security record and an info log line for each steered batch.

6. **Version skew.**
   With an api-server from this branch and an agent runtime from before 03, `servesSteering` is missing, so channels do not steer, as today.

7. **Docs.**
   - [`channel-turns.md`](../../architecture/channel-turns.md) "Inbound": the runtime decides each steer at a steer point, into the conversation's own running turn, for every harness that steers.
     "The turn watch": a held steer has no time limit while its turn runs.
     Keep the additions short; the page is near its size cap.
   - [`slack-guarantees.md`](../../architecture/slack-guarantees.md) §3 "Delivery" and the §6 "Steering" row.
   - Update **Last verified** on both.

## Acceptance criteria

- [x] In a Slack thread with an agent on Claude, a follow-up that mentions the agent, sent while the first command of the three-command task runs, is answered in the same turn, and the agent runs no later command it was told to skip.
- [ ] The same holds on Codex and Pi, and on Claude in a Telegram chat.
- [x] On an agent whose harness does not steer, a follow-up runs as the next turn, with its own reply.
- [x] A follow-up that is steered is never also run as a turn of its own, also when the steer is answered after its turn's relay ended.
- [ ] In a 1:1 DM, a thread reply to a message whose steer is held does not start a second session on the same message.
- [x] A message with attachments and a read-along message are still never steered.
- [x] `mise run check` and `mise run test` pass for `api-server`.

## Smoke test

1. `mise run cluster:build -- api-server agents`.
2. In a Slack thread bound to an agent on Claude, mention the agent and ask for the three-command task.
   While the first command runs, reply in the thread, mention the agent, and write "Skip the other commands and reply only DONE".
   Expect a reply that says DONE and does not contain CHARLIE.
3. Repeat step 2 on Codex and on Pi, by changing the agent's default Harness, and on Claude in a Telegram chat.
4. Repeat step 2 on Bob, which does not steer until 06, and expect the follow-up to run as the next turn.
5. Restart the api-server deployment while a steer is held (`mise run cluster:kubectl -- rollout restart deploy/platform-apiserver`), and check that the follow-up reaches the agent at most once.

Then print a short manual guide so that the user can repeat steps 2 and 4 by hand.
