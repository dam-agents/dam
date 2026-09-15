# 09 — Slack posts the bind link on join

**Part of:** UI — Slack integration discoverability — see [README](./README.md)

## Context

Someone who invites the bot to a channel from inside Slack currently gets **silence**. Nothing
says what to do next. If they then mention the bot, the channel reply is "No instance connected
to this channel." — no instruction, no link, and a word the product no longer uses. That is a
dead end in the one place the user is already acting, which is exactly what this issue is about.

The fix is small because almost all of it exists. `/dam bind` is only a link factory: it notes
which channel and which Slack user, mints a one-time login link, and replies with it privately.
A bot join event carries the same two facts, so the same link can be offered unprompted. **The
reply copy already exists verbatim** at
[`slack.ts:1795`](../../../packages/api-server/src/modules/channels/infrastructure/slack.ts) —
Figma moved *when* it appears, not *what* it says.

Backend only. Apply the `/typescript-engineering` skill.

## Reference frame

- The message in a real Slack channel — **view 6**

No DAM UI changes, so there is nothing to match visually. Read the frame for the message's shape
and its "Only visible to you" placement.

## Implementation plan

1. **Subscribe to the bot's own join.** The gateway handles `app_mention` and message events
   today; add the member-joined event and act only when the joining member is the bot itself. Add
   the matching scope and event subscription to
   [`etc/slack/app-manifest.yaml`](../../../etc/slack/app-manifest.yaml).

2. **Mint the link exactly as the slash command does.** Reuse the `bind` branch's path — generate
   PKCE, store the pending OAuth flow against the inviter's Slack user id and the channel id,
   build the authorize URL. Factor the shared part out rather than duplicating it, so the two
   triggers cannot drift.

3. **Post it as an ephemeral to the inviter**, using the existing copy — the channel variant for a
   channel, the DM variant where it applies — including the "already connected here" clause when
   the conversation already has agents.

4. **Handle the edges.**
   - **No inviter** on the event: there is nobody to message. Do nothing, and do not error.
   - **Inviter is not a DAM user**: they follow the link and meet login. The bind page's existing
     "you don't own any agents yet" path already covers what happens next. Nothing extra here.
   - **Conversation already bound**: still post, using the existing already-connected clause — a
     channel may hold several agents.
   - **Bulk installs**: the message is ephemeral and one per join, so each inviter sees one private
     note. No extra throttling needed, but do not post on anything other than the bot's own join.

5. **Fix the unbound-channel reply.** `unboundConversationCopy` gives DMs and group DMs a helpful
   sentence but channels get "No instance connected to this channel." Bring it in line: say no
   agent is connected and how to connect one. Drop the word "instance" — the product's noun is
   **Agent**.

6. **Leave the rest of the flow alone.** Same link, same login, same picker, same binding. Only
   the trigger is new.

## Two things this does not change

- **The bind modal's step 2 stays as drawn.** This slice makes `/dam bind` optional only for
  someone who invites the bot. A join event does not fire for a channel the bot is already in, and
  a DM has no invite at all — the modal tells the user to skip step 1 there. So the command remains
  the only route in both cases. Do not remove or weaken step 2.
- **Telegram gets no equivalent.** Telegram has no ephemeral — any bot message goes to the whole
  group — and only admins may bind, so a public prompt is a product decision rather than a
  translation of this one. Out of scope here; its own issue if it is wanted.

## Acceptance criteria

- [ ] Inviting the bot to a channel posts a message visible only to the inviter, carrying a working
      bind link.
- [ ] The link completes a bind with no slash command typed.
- [ ] The message names the agents already connected, where there are any.
- [ ] A join event with no inviter produces no message and no error.
- [ ] The link-minting path is shared with the slash command, not duplicated.
- [ ] The app manifest declares the new event and scope.
- [ ] Mentioning the bot in an unconnected **channel** now explains how to connect one, and says
      "agent" rather than "instance".
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

```bash
mise run check && mise run test
```

On the local dev cluster, reinstall the Slack app so the new manifest takes effect. Invite the bot
to a fresh channel and confirm a message appears that only you can see, carrying the link. Follow
it without typing any command and complete a bind. Invite the bot to a second channel that already
has an agent and confirm the message names the existing one. Finally, mention the bot in a
different unconnected channel and confirm the reply now explains how to connect an agent.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
