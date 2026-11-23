# 10 — Harness prompts in runs nobody watches

**Depends on:** 06-when-cards-go-out, 09-harness-prompts-on-slack-turns
**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Context

In a schedule fire or a sub-agent run, nobody is engaged when a harness asks: the runtime waits 10 minutes (`DEFAULT_ORPHAN_TTL_MS` in `acp-runtime.ts`), the row waits on Home, and then the tool call fails (production: about 24 a day after the Bob v0.3.0 fix, all from Bob).
A sub-agent spawn already drops a `needsApproval` choice, so a sub-agent asks only for a harness's built-in reasons.
This slice sends such a prompt to the owner as a row of the agent's background card, under the timing rule of [06](./06-when-cards-go-out.md), and makes the runtime wait the hold window for permission prompts.
The runtime's 10-minute wait covers every request the agent sent on the session, and its end recycles the machine's lease, so only permission prompts get the longer wait; every other request keeps 10 minutes.
An agent on an older image still gives up after 10 minutes, so the card shows the deadline the runtime reports, never an assumed one.
[09](./09-harness-prompts-on-slack-turns.md) decided, with its data check, whether this slice goes ahead.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **The runtime waits longer for permission prompts only.** In `packages/agent-runtime/src/modules/acp/services/acp-runtime/pending-agent-requests.ts`, keep the 10-minute timer (`orphanTtlMs`) for every pending request that is not a `session/request_permission`, and give an unwatched permission request its own wait, equal to a new `permissionTtlMs`.
   The api-server passes the hold window as `permissionTtlMs` in the runtime config it already sends; no literal.
   The lease recycles when the requests it waited for expire, as today.
2. **The runtime reports its deadline.** When the runtime announces an unwatched request (`observer.waiting`), it adds the deadline it will keep.
   The approvals service (`recordAcpNativePending`) sets the `acp_native` row's `expiresAt` to that deadline, or to 10 minutes after the request when an older runtime sends none, and gives the row the route `background`.
3. **Placement.** The sweep of [05](./05-card-lifecycle.md) places the request as a row of the agent's background card by the timing rule of [06](./06-when-cards-go-out.md).
4. **Renderer.** In `channels/domain/`, add the background prompt row: the run (schedule or sub-agent), the tool and its input as the prompt row of [09](./09-harness-prompts-on-slack-turns.md) shows them, the deadline from the row, and one button per harness option.
   The answer uses the `decide` mapping of [09](./09-harness-prompts-on-slack-turns.md).
5. **Schedules that overlap.** Check what a schedule does when it fires while its previous run still waits on a prompt, and write it in the docs; change nothing.
6. **Docs.** In `docs/architecture/sessions.md` and `docs/architecture/schedules.md`, an unwatched permission prompt waits the hold window and can reach the owner in Slack; other requests keep 10 minutes.
   In `docs/architecture/tool-approval.md`, one sentence that a prompt in a run nobody watches reaches the owner in Slack.
   In `docs/architecture/slack-owner-requests.md`, the background prompt row and its deadline.
   In `.quality-inspector/qi-profile-dam/SKILL.md`, the background prompt row.

## Acceptance criteria

- [ ] A harness prompt in a schedule fire or a sub-agent run waits the hold window, and with the web UI closed the owner's background card gets a prompt row about 60 seconds later; Allow once lets the call through.
- [ ] The prompt row shows the deadline the runtime reported.
- [ ] Another unanswered request of the same session (not a permission prompt) still expires after 10 minutes.
- [ ] `mise run check`, `mise run //packages/api-server:test` and `mise run //packages/agent-runtime:test` pass.

## Smoke test

Set up as in [01](./01-one-hold-decision.md), with a Bob agent on Auto-approve.

1. Give the Bob agent a schedule whose task writes into `~/.bob`, close the web UI and run it: about a minute later the background card shows a prompt row with a deadline 30 minutes after the request.
2. Allow once: the schedule's turn goes on.
3. Run it again and leave the card: after the hold window, the call fails and the row reads "Expired".
