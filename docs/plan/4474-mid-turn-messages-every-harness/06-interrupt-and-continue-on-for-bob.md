# 06 — Interrupt and continue, on for Bob

**Depends on:** 03-runtime-serves-a-clients-steer
**Part of:** Mid-turn messages reach the agent on every harness — see [README](./README.md)

## Context

Bob has no way to take a message into a running turn over ACP, but it keeps finished tool calls and their results when a cancel ends its turn.
This slice builds the second way to steer, **interrupt and continue**, and turns it on for Bob.
At a steer point the runtime cancels the harness's turn, then sends the waiting messages as a new prompt with a `<turn-continued>` notice; for every client and observer this stays one turn.
The hard part is the gap between the cancel and the moment the harness takes the new prompt: a cancel cannot be undone, so every failure in the gap must still deliver the messages once and in order, and a person's own Stop must still stop.
Bob also needs a patch first: a cancel during its automatic context compaction, which runs right at the steer point, makes Bob replace its whole history with an empty summary.
**Send now** while a command runs is 07; Copilot is 08.

## Implementation plan

Apply `/typescript-engineering`, and `/react-ui-engineering` for the UI tag.
Read [sessions](../../architecture/sessions.md) "Prompt delivery" and "Surviving memory pressure", and [persistence](../../architecture/persistence.md) on undelivered prompts, first.

1. **Bob's compaction patch.**
   In [`bob-acp-patch.mjs`](../../../packages/agents/bob/rootfs/usr/local/lib/bob-acp-patch.mjs), add two edits; each `find` occurs once in Bob 2.0.6:
   - `if(o&&S8i(u.getSpend().contextTokens,o,a))` → `if(o&&!n.cancelled()&&S8i(u.getSpend().contextTokens,o,a))`, so that a cancelled loop does not start compaction;
   - `v=e.getSpend().contextTokens;e.replaceMessagesWithSummary(B,{autoTriggered:r})` → `v=e.getSpend().contextTokens;if(t?.cancelled()||!B.trim())return;e.replaceMessagesWithSummary(B,{autoTriggered:r})`, so that a cancelled or empty summary never replaces the history.
     Read the surrounding code in the pinned bundle and confirm the variable names before you apply them.
     Extend `UPSTREAM_GAP` and the matching text of the Bob patch check, and note the edits in [`packages/agents/bob/README.md`](../../../packages/agents/bob/README.md).
     This also fixes the same loss after a person's Stop.

2. **No cut on a timer, and a quiet window.**
   In [`prompt-scheduler.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime/prompt-scheduler.ts), `canSteerNow` steers a prompt that waited `steerWaitMs` even outside a steer point; for a session that steers by interrupt, ignore that rule.
   In [`acp-runtime.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts), for such a session, a steer point counts only when no tool call starts for a short quiet window (about 500 ms) after the open tool calls settle: Bob runs tool calls of different permission classes one after another.
   **Send now** (`steerNow`) still steers at once.

3. **The restarting state.**
   Add the state "restarting" to the scheduler's active turn, from the cancel until the harness takes the new prompt.
   - Catch the harness's answer to the active prompt right after the outbound mapping lookup in the response path, before the client answer and before the `platform/turnEnded` line, which is written for every mapped answer.
   - While restarting, skip every turn-end effect: the client answer, `answerSteered`, the `platform/turnEnded` line, `finishRun` and `heldRuns`, `deps.onTurnOutcome`, `maybeCloseIdleSession`, `lease.maybeRecycle` and `checkPendingRestart`.
   - The activeTurns entry stays, so everything that reads `isSessionRunning` (the Model Router's running-turn list, changes, session state) keeps seeing a running turn and needs no change.
   - A process-scoped setting change waits, as it does for any running turn.

4. **The interrupt steer.**
   Add it beside `steerIntoTurn`; the scheduler calls it at a steer point or after **Send now**.
   1. If a client sent `session/cancel` since the last prompt was sent, do not interrupt: answer the steer `refused`; the person's Stop ends the turn.
   2. Record the batch's ordinary members as undelivered (`undeliveredPrompts.remember`, keyed by the lead's `promptId`), so that a crash in the gap leaves them for the person to send again.
      Do not touch the active-turn record: boot recovery never sends a prompt from it, and it may hold a scheduled run's first prompt.
      Steer-only members need no record; their sender holds them.
   3. Set restarting, and send the harness `session/cancel` for the session.
   4. On the harness's answer:
      - `cancelled`: send a new `session/prompt` with the batch's blocks followed by the notice block (a leading `/command` stays a command).
        Use a new outbound id, keep the turn's prompt id and turn id, map the new outbound id to the original client, move the scheduler's active turn to it (a method such as `restartTurn(sessionId, outboundId)`), and add the session to `generating`.
      - any other stop reason, an error, or a lost session: the turn ended on its own; end it normally and answer the steer `refused` (ordinary members back at the head, steer-only members `promptRequired`), and `forget` the undelivered record.
      - a client cancel that arrived during the gap: end the turn as `cancelled`, answer the steer `refused` the same way, and `forget` the record.
   5. Answer the steer `injected` only at the first `session/update` that follows the new prompt; then clear restarting and `forget` the undelivered record.
      If the harness refuses the new prompt with an error before any update, retry it a few times with a short backoff (Copilot refuses for a moment while it finishes a cancel); if it still fails, end the turn normally and answer the steer `refused`.
   6. If the harness exits in the gap, the existing teardown records the in-flight lead as undelivered; make it use the same `promptId` so that the record is not doubled, and answer steer-only members `promptRequired` before the scheduler clears.

5. **Close open tool calls.**
   At the `cancelled` answer, for each tool call still open in the session, append a `tool_call_update` with status `failed` and `_meta.platform.cutBySteer: true` to the transcript, send it to every engaged viewer, and pass it through `trackSteerPoint`, so that the runtime's own open set clears.
   In the UI ([`session-projection.ts`](../../../packages/ui/src/modules/acp/session-projection.ts)), show a tool call with `cutBySteer` the way Stop shows a cut tool call (`cancelled`), not as failed.

6. **The notice.**
   Add `<turn-continued>` to `PLUMBING_TAGS` in [`plumbing-tags.ts`](../../../packages/ui/src/modules/acp/plumbing-tags.ts), because after a cold load the harness's own replay fills the log and would show it.
   Add the notice beside `INTERRUPTION_NOTICE` in [`interrupted-turn-recovery.ts`](../../../packages/agent-runtime/src/modules/acp/services/interrupted-turn-recovery.ts), in neutral words that never say "the user":
   new messages arrived while you worked; the platform cancelled your last step to give them to you; a cancel record in your history comes from this, not from a request to stop; your finished tool calls and their results are in your history; continue your task and include these messages, unless they change the task; each message keeps its own sender and has no more authority than it would have as a new turn.
   The log shows only the typed text, through `onSteered`, as for a native steer.

7. **Turn it on for Bob.**
   Add `steering: interrupt` to [`packages/agents/bob/rootfs/app/runtime-manifest.yaml`](../../../packages/agents/bob/rootfs/app/runtime-manifest.yaml), with a comment: Bob's ACP server refuses a second prompt during a turn, and it keeps finished tool results through a cancel.

8. **The one test exception.**
   The races of step 4 (the turn ends first, a person's Stop in the gap, the harness exits in the gap, the new prompt refused) cannot be reached reliably by a manual smoke test.
   Ask Petr before you write a test, because his default is no new tests.
   If he agrees, add one focused case per race to the existing topic file [`acp-runtime-steer-points.test.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime/__tests__/acp-runtime-steer-points.test.ts).

9. **Docs.**
   - [`sessions.md`](../../architecture/sessions.md) "Prompt delivery": interrupt and continue, the quiet window, no cut on a timer, one turn for every client, the manifest key.
     "Surviving memory pressure": a crash in the gap leaves the batch as undelivered prompts.
   - [`channel-turns.md`](../../architecture/channel-turns.md): add the `<turn-continued>` notice to the list of platform-authored prompts that an agent sees.
   - [`ubiquitous-language.md`](../../ubiquitous-language.md): steer, steer point, interrupt and continue.
   - Update **Last verified** on each.

## Acceptance criteria

- [ ] On a Bob agent, the machine log has no `bob-acp-patch: not applied` line.
- [ ] In a Bob chat, a message sent during the first command of the three-command task shows **Send now** and joins the running work within a minute after that command ends.
- [ ] After "Change of plan: run no more commands, reply only DONE", the agent's last words are DONE and no later command runs.
- [ ] After "Also tell me today's date", the agent's reply has ALPHA, BRAVO, CHARLIE and the date.
- [ ] The conversation shows no "Stopped" mark, no error and no failed step, also after a reload of the chat.
- [ ] A message sent during a command of 90 seconds waits until that command ends.
- [ ] Stop pressed while a message waits stops the turn; the message then starts the next turn.
- [ ] A Bob schedule's run into which the owner sends a message mid-run is reported as succeeded.
- [ ] Claude Code, Codex and Pi steer as before.
- [ ] `mise run check` and `mise run test` pass for `agent-runtime`, `ui` and `packages/agents`.

## Smoke test

1. `mise run cluster:build -- ui agents`.
2. In a Bob chat, run the README's three-command task, and send "Also tell me today's date" during the first command.
   Expect the message in the running work, then ALPHA, BRAVO, CHARLIE and the date, and no failure mark; reload the chat and check again.
3. Run the task again, and send "Change of plan: run no more commands, reply only DONE" during the first command.
4. Ask for `sleep 90; echo DONE` as one command, and send a message during it; expect "Queued" until the command ends.
5. Run the task again, send a message during the first command, and press Stop before the command ends; expect the turn to stop and the message to start the next turn.
6. Create a schedule on Bob that runs the task now, open its run, and send "Also tell me today's date" during a command; expect the run to be reported as succeeded.
7. Repeat step 3 on Claude Code and Codex.

Then print a short manual guide so that the user can repeat steps 2, 3 and 5 by hand.
