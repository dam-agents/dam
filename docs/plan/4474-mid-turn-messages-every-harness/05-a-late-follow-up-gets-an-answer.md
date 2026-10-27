# 05 — A late follow-up gets an answer

**Depends on:** 04-slack-and-telegram-steer-through-the-runtime
**Part of:** Mid-turn messages reach the agent on every harness — see [README](./README.md)

## Context

A follow-up can join the running turn after the agent has already posted its reply: on Codex and Pi a steer lands one model step late, and on any harness the agent can reply early and keep working.
Two rules then leave the follow-up unanswered.
Both steer frames tell the agent "answer everything in one reply rather than replying more than once", and Slack counts a turn as answered when any of its messages got a post, so the delivery nudge never asks again.
Before 04, each such follow-up ran as its own turn and got its own reply, so without this slice 04 would make channels worse.
This slice changes the frame wording, judges Slack delivery per steered message, adds a nudge that names the unanswered follow-ups, and makes a silent Telegram follow-up visible in the log.

## Implementation plan

Apply `/typescript-engineering`.
Read [channel turns](../../architecture/channel-turns.md) "The turn watch" ("What counts as answered") first.

1. **Frame wording.**
   Change `steerFrame` in [`slack.ts`](../../../packages/api-server/src/modules/channels/infrastructure/slack.ts) and in [`telegram.ts`](../../../packages/api-server/src/modules/channels/infrastructure/telegram.ts).
   - Put every instruction line before the first speaker line: the session view drops the lines before the first speaker line and adds every later line to the last message.
   - Say where the messages came from: the same Slack conversation, or the same Telegram chat.
   - Replace the one-reply sentence with three rules: if you have not posted yet, answer everything in one reply; if you already posted a reply that does not cover these messages, post one more that answers only them, with the reply tool and the target that the frame names; if they need no answer, call `no_reply_needed` for them.
   - In a 1:1 DM, keep the rule that each answer names the `[ts …]` of the message it answers.
   - Keep the `[ts …]` and `[@…]` speaker lines as they are.
   - Change the assertion that checks the old sentence on purpose (`slack-turn-coalescing.test.ts`, near line 196).

2. **Slack answered rule.**
   In `slack.ts`, judge delivery per steered message.
   A turn with steered refs is delivered when, for each reply target (`threadTs`), the newest steered ref was posted to, declined, handed off or reacted to; a turn without steered refs keeps today's rule.
   Today `deliveredBy` accepts any ref with a flag; `noteEngagedTurn` marks the newest matching ref, which is the steered ref in a thread.
   Make `disposition()` in the undelivered nudge use the same flags.
   Note a reply on its ref when the reply call starts, not when Slack returns, so that a reply already in flight when a steer lands does not count for the steered message.

3. **A nudge for unanswered follow-ups.**
   Today's nudge says that the turn ended without any reply, which is false here and invites the agent to post its first answer again.
   Add a second nudge text for this case: you replied, but these messages that arrived while you worked got no answer; it lists them with their `[ts …]` and speakers, and names `no_reply_needed`.
   Send it with the reply target and anchor of the unanswered steered ref, not of the turn's first message.

4. **Telegram.**
   Telegram has no delivery nudge.
   Log a warning when a turn with a steered batch ends without a `send_channel_message` to that chat after the steer, so that a silent follow-up is visible.

5. **Docs.**
   - [`channel-turns.md`](../../architecture/channel-turns.md) "What counts as answered": a steered message counts as answered only by a reply, decline, hand-off or reaction after it; the nudge for unanswered follow-ups; the Telegram gap.
     Keep it short.
   - Update **Last verified**.

## Acceptance criteria

- [x] In a Slack thread, an agent asked to post READY, then wait 60 seconds, then post nothing more, answers a question that mentions it during the wait, in another reply within five minutes.
- [x] The same holds on Codex and on Claude.
- [x] A follow-up that the agent answered in its single reply gets no nudge and no second reply.
- [x] A follow-up that needs no answer, such as "thanks", can end with `no_reply_needed` and gets no reply.
- [ ] In Telegram, a steered follow-up that the agent leaves unanswered leaves a warning in the api-server log.
- [x] `mise run check` and `mise run test` pass for `api-server`.

## Smoke test

1. `mise run cluster:build -- api-server`.
2. In a Slack thread bound to an agent on Claude, mention the agent: "Post READY in this thread, then run `sleep 60`, then post nothing more."
   After READY appears and during the wait, reply in the thread, mention the agent, and ask "What is 17 times 3?".
   Expect another reply in the thread that says 51, within five minutes.
3. Repeat step 2 on Codex.
4. Repeat step 2, but send "thanks" instead of the question, and expect no new reply.
5. In the api-server log, check whether `slack.turn.unanswered` fired, to see which path answered the follow-up.

Then print a short manual guide so that the user can repeat steps 2 and 4 by hand.
