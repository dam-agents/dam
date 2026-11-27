# 10 — Harness prompts in runs nobody watches

**Depends on:** 06-when-cards-go-out
**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Context

In a schedule fire, a sub-agent run, or a chat that nobody has open, nobody is engaged when a harness asks: the runtime waits 10 minutes (`DEFAULT_ORPHAN_TTL_MS` in `acp-runtime.ts`), the row waits on Home, and then the tool call fails (production, 2026-11-20 to 2026-11-26: 133 expired, all from Bob, about 19 a day).
A sub-agent spawn already drops a `needsApproval` choice, so a sub-agent asks only for a harness's built-in reasons.
This slice sends such a prompt to the owner as a row of the agent's background card, under the timing rule of [06](./06-when-cards-go-out.md), lists it in `/dam approvals`, and makes the runtime wait the hold window for permission prompts.
The runtime's 10-minute wait covers every request the agent sent on the session, and its end recycles the machine's lease, so only permission prompts get the longer wait; every other request keeps 10 minutes.
An agent on an older image still gives up after 10 minutes, so the row's expiry is the deadline the runtime reports, never an assumed one.
[09](./09-harness-prompts-on-slack-turns.md) was dropped after its data check: a prompt on a Slack turn stays refused at once, and this slice takes its prompt row and its map from a button to the harness's option.

Prompt shapes, from the local cluster:

- Claude Code (`claude-agent-acp`) puts the canonical tool name in a top-level `name`, and offers allow always, allow once and reject.
- Bob sends no `name` and no `_meta`: only `toolCallId`, `title` (the display text with the path or the command), `kind`, `rawInput` and `content`; its protected calls offer only allow once and reject.
- The repository has no CUGA harness.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **The runtime learns the hold window.** The api-server sends no runtime settings today, and the runtime ignores the hello result.
   The hello result gets an optional `permissionWaitMs`, which the api-server sets from `config.approvalHoldSeconds`; the runtime keeps it for the ACP module.
   An older api-server sends none, and the runtime keeps 10 minutes.
2. **The runtime waits longer for permission prompts only.** In `packages/agent-runtime/src/modules/acp/services/acp-runtime/pending-agent-requests.ts`, keep the 10-minute timer (`orphanTtlMs`) for every pending request that is not a `session/request_permission`, and give an unwatched permission request its own timer of `permissionTtlMs`.
   The lease recycles when the requests it waited for expire, as today.
3. **The runtime reports its deadline.** When the runtime announces an unwatched request (`observer.waiting`), it adds the deadline it will keep, and the `approvals.v1.waiting` report sends the time left (`waitMs`), so the two clocks need not agree.
4. **The row gets the route and the deadline.** `recordAcpNativePending`, called from the runtime's report, sets the `acp_native` row's `expiresAt` to now plus `waitMs`, or to 10 minutes from now when an older runtime sends none, and gives the row the route `background`.
   A row the ACP relay wrote for a watched session keeps no route.
   `ApprovalRequested` and every `ApprovalResolved` of an `acp_native` row carry the route, so a card row settles at once wherever the prompt is answered.
5. **Placement.** The sweep of [05](./05-card-lifecycle.md) places the request as a row of the agent's background card by the timing rule of [06](./06-when-cards-go-out.md); nothing changes there.
6. **Renderer.** In `channels/domain/`, add the prompt row: the agent and the tool's title as `plain_text`, the kind of session (a scheduled run, a run, a chat), its `rawInput` in a code block cut at about 2,500 characters with "Open in app" when cut, the deadline from the row, and one button per option the harness offered, with the web's labels: Allow once (`primary`), Always allow, Deny (`danger`) and Always deny.
   The list of [08](./08-dam-approvals-and-mute.md) shows the same row, with the input cut at 500 characters.
7. **Answer.** Map each option kind to the card answer whose approvals service verdict the web uses for an `acp_native` row: allow once → approve once, allow always → the permanent allow, reject once → deny once, reject always → deny forever.
   The service answers the harness through `pickOptionId`, as for a click in Home.
8. **Who waits.** A prompt row never says "Nobody waits for this now": `anyoneWaits` counts gateway waiters only, so a row of another type waits while it is pending.
9. **Schedules that overlap.** Check what a schedule does when it fires while its previous run still waits on a prompt, and write it in the docs; change nothing.
10. **Docs.** In `docs/architecture/sessions.md` and `docs/architecture/schedules.md`, an unwatched permission prompt waits the hold window and can reach the owner in Slack; other requests keep 10 minutes.
    In `docs/architecture/tool-approval.md`, one sentence that a prompt in a run nobody watches reaches the owner in Slack.
    In `docs/architecture/slack-owner-requests.md`, the background prompt row and its deadline.
    In `.quality-inspector/qi-profile-dam/SKILL.md`, the background prompt row.

## Acceptance criteria

- [ ] A harness prompt in a schedule fire or a sub-agent run waits the hold window, and with the web UI closed the owner's background card gets a prompt row about 60 seconds later; Allow once lets the call through.
- [ ] The prompt row shows the deadline the runtime reported.
- [ ] Another unanswered request of the same session (not a permission prompt) still expires after 10 minutes.
- [ ] A prompt on a Slack turn is still refused at once.
- [ ] `/dam approvals` lists a waiting prompt with its buttons, and a click there answers the harness.
- [ ] `mise run check`, `mise run //packages/api-server:test` and `mise run //packages/agent-runtime:test` pass.

## Smoke test

Set up as in [01](./01-one-hold-decision.md), with a Bob agent on Auto-approve.

1. Give the Bob agent a schedule whose task writes into `~/.bob`, close the web UI and run it: about a minute later the background card shows a prompt row with a deadline one hold window after the request.
2. Allow once: the schedule's turn goes on and the file is written.
3. Run it again and answer from `/dam approvals` with Deny: the write is refused, and the card row and the list say so.
4. Run it again and leave the card: after the hold window, the call fails and the row reads "Expired".
