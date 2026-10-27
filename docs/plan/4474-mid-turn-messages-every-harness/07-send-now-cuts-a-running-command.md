# 07 — Send now cuts a running command

**Depends on:** 06-interrupt-and-continue-on-for-bob
**Part of:** Mid-turn messages reach the agent on every harness — see [README](./README.md)

## Context

On an interrupt harness, a waiting message joins only at a steer point, so it can wait as long as a command runs.
**Send now** is the person's way to send it at once, and on Bob and Copilot that cancels the running command.
Three things go wrong there that a steer point never meets.
A pending permission request must be answered by whoever cancels, or the harness may wait for ever.
The agent must learn that the command was stopped and may have partly run, so that it does not, for example, push or migrate a second time.
And Bob kills only the command's shell, so a child process can keep running.
This slice handles the three for Bob; 08 checks them on Copilot.

## Implementation plan

Apply `/typescript-engineering`.

1. **Pending permission requests.**
   Before the interrupt steer of 06 sends `session/cancel`, answer every pending agent request of the session `{ outcome: { outcome: "cancelled" } }` through the runtime's pending-request store, and notify the engaged viewers, so that no permission card stays open.
   Find the store from `pending-agent-requests.ts` in the ACP runtime.

2. **The notice for a cut command.**
   When the interrupt cut an open tool call (06 step 5), add a sentence to the `<turn-continued>` notice: the command that was running was stopped and may have partly run; check its effects before you run it again.

3. **The process check.**
   In a Bob chat, ask for `bash -c 'sleep 120; echo DONE > /tmp/left-over'` as one command, and click **Send now** during it.
   After two minutes, check in the agent's terminal whether `/tmp/left-over` exists or a `sleep 120` process still runs.
   Bob stops the command's shell only, so expect the child to survive.
   Record the result in [`packages/agents/bob/README.md`](../../../packages/agents/bob/README.md).
   If the child survives, add to the notice of step 2 that the command may still be running.

4. **Docs.**
   In [`sessions.md`](../../architecture/sessions.md) "Prompt delivery", say what **Send now** does on an interrupt harness: it cancels the running command, answers a pending permission request as cancelled, and tells the agent.
   Update **Last verified**.

## Acceptance criteria

- [ ] In a Bob chat in which the agent runs `sleep 120`, **Send now** on a queued message puts it into the running work within ten seconds.
- [ ] The cut command shows the way a command cut by Stop shows, not as failed, also after a reload.
- [ ] The agent's next step mentions that the command was stopped, and does not run it again without a check.
- [ ] With Bob in its asking mode, **Send now** while a permission request is open closes the request in the chat, and the turn continues with the message.
- [ ] The process check result is in Bob's README.
- [ ] `mise run check` and `mise run test` pass for `agent-runtime`.

## Smoke test

1. `mise run cluster:build -- agents`.
2. In a Bob chat, ask for `sleep 120; echo DONE` as one command, send "Stop waiting and reply WAITED" during it, and click **Send now** on it.
   Expect the message in the running work within ten seconds, the command shown as stopped, and a reply that says WAITED.
3. Switch the chat's Bob approvals to ask, ask for a command that needs approval, and click **Send now** on a queued message while the approval card shows.
   Expect the card to close and the work to continue with the message.
4. Run the process check of step 3 of the plan.

Then print a short manual guide so that the user can repeat steps 2 and 3 by hand.
