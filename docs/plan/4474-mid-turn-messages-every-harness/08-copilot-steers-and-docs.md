# 08 — Copilot steers, and the per-harness docs

**Depends on:** 05-a-late-follow-up-gets-an-answer, 07-send-now-cuts-a-running-command
**Part of:** Mid-turn messages reach the agent on every harness — see [README](./README.md)

## Context

Copilot's ACP server is native code with no steering method; a second prompt cancels its running turn, and a cancel at a steer point keeps its finished tool results, which was tested.
This slice turns interrupt and continue on for Copilot and checks the parts of Copilot's behaviour that cannot be read from its native code: what it keeps through a cancel, its cut tool calls, its refusal of a prompt right after a cancel, and a cancel during its background compaction.
It then writes the per-harness table into the docs and walks the whole feature.

## Implementation plan

Apply `/typescript-engineering` for any runtime change that a check makes necessary.

1. **Turn it on for Copilot.**
   Add `steering: interrupt` to [`packages/agents/copilot/rootfs/app/runtime-manifest.yaml`](../../../packages/agents/copilot/rootfs/app/runtime-manifest.yaml), with a comment: Copilot's ACP server has no steering method, and a cancel keeps finished tool results.
   Note it in [`packages/agents/copilot/README.md`](../../../packages/agents/copilot/README.md).

2. **Checks on Copilot.**
   Record each result in Copilot's README.
   - **Continuation.** After an interrupt, the new prompt is taken, after the retry of 06 when Copilot first refuses it.
   - **Late cancel.** The cancel never lands on the new prompt.
   - **Kept work.** After "Also tell me today's date" during the first command, the reply still has ALPHA, BRAVO and CHARLIE.
   - **Cut command.** **Send now** during `sleep 120` shows the command as stopped, not pending or failed, and the process check of 07 on Copilot.
   - **Partial text.** **Send now** while the agent writes a long reply: the agent continues without repeating or losing its task.
   - **Compaction.** Find how Copilot shows its background compaction in the ACP stream ("The conversation history has been summarized…"), and steer while it runs.
     Pass: the agent still knows its task and an earlier tool output.
     If a check fails and cannot be fixed in the runtime, remove Copilot's `steering: interrupt` key, so that Copilot does not steer, and record why in its README and in the README of this plan.

3. **Per-harness docs.**
   - In [`sessions.md`](../../architecture/sessions.md) "Prompt delivery", add a table of the five harnesses: native or interrupt, when the model reads a steered message, how long a message can wait, and what **Send now** does (Claude Code moves a running command to the background; Bob and Copilot stop it).
   - In [`slack-guarantees.md`](../../architecture/slack-guarantees.md) §6, the "Steering" row: the same facts in one line per harness, including that only Stop stops at once.
   - Update **Last verified** on both.

4. **Whole-feature walk.**
   Run the README's whole-feature smoke test.

## Acceptance criteria

- [ ] In a Copilot chat, a message sent during the first command of the three-command task shows **Send now** and joins the running work within a minute after that command ends.
- [ ] After "Also tell me today's date", Copilot's reply has ALPHA, BRAVO, CHARLIE and the date, and the conversation shows no failure mark.
- [ ] **Send now** during `sleep 120` on Copilot puts the message into the running work within ten seconds, and the command shows as stopped.
- [ ] Each check of step 2 has a recorded result, and a failed check has its consequence in the docs.
- [ ] Every acceptance criterion of the README passes in the whole-feature smoke test.
- [ ] `mise run check` and `mise run test` pass for the whole repository.

## Smoke test

1. `mise run cluster:build -- api-server ui agents`.
2. In a Copilot chat, run 06's smoke test steps 2 to 5 and 07's smoke test step 2.
3. In a Slack thread and a Telegram chat bound to an agent whose default Harness is Copilot, and then Bob, run the README's AC-6 and AC-8 steps.
4. Run the README's whole-feature smoke test.

Then print a short manual guide so that the user can repeat steps 2 and 3 by hand.
