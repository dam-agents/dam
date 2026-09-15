# 06 — Session rows show their channel

**Depends on:** 01-channel-name-resolution
**Part of:** UI — Slack integration discoverability — see [README](./README.md)

## Context

A session driven from Slack or Telegram currently shows a generic `#` glyph and a "Thread" or
"Ambient" label. Nothing says *which* conversation it belongs to, so an agent serving several
channels gives a session list you cannot read. This slice names the conversation on every
channel session.

Apply the `/react-ui-engineering` skill.

## Ask for the Figma frame first

- Sessions sidebar with channel sessions — **view 30**

The frame carries two annotations; read them with it.

## Implementation plan

1. **Replace the `#` glyph with the messenger logo** in the row's right-hand slot — Slack's or
   Telegram's. The slot shows the working indicator instead while a turn is running, so the two
   are alternatives, not stacked.

   The annotation *"Instead of # symbol, let's use the logo"* is about **this icon**. The `#`
   inside the channel name text stays.

2. **Put the conversation in the subtitle**, as `<conversation> · <relative time>`, replacing
   today's "Thread · <timestamp>" and "Ambient · <timestamp>".

   - **Slack** renders `#channel-name`.
   - **Telegram** renders the chat title, with **no** `#`.

   A session whose conversation cannot be resolved shows the time alone rather than a broken
   subtitle.

3. **Resolve each side's conversation.**

   - **Slack.** The channel id is already on the wire, encoded in `threadTs` as `<channelId>:<ts>`
     or `ambient:<channelId>`. Parse it with the helper from sub-issue 01, then resolve the name.
   - **Telegram.** `threadTs` holds the conversation id directly, and `useTelegramChats(agentId)`
     already returns `{ conversationId, title }`. This is a client-side join — **no backend work**.

   Do not copy the prototype here: it casts a `channelName` onto the session view that no contract
   provides, which only works against mock data.

4. **Switch every session row to relative time.** "31m ago", "2h ago", "12h ago". The annotation
   asks for it and the frame shows it on non-channel rows too, so this is a deliberate global
   change, not scope creep.

5. **Remove the ambient indicator** — the `#` glyph with the superscript "A". Figma shows no
   ambient marker on any row.

   Worth knowing while you do it: `isAmbientThreadKey` already exists, so ambient remains
   distinguishable at zero cost — the design simply chooses not to show it. Remove the marker as
   drawn; do not remove the helper, which sub-issue 01's parser and other callers rely on.

## Acceptance criteria

- [ ] Slack sessions show the Slack logo; Telegram sessions show the Telegram logo.
- [ ] A running session shows the working indicator instead of a logo.
- [ ] Slack session subtitles read `#channel-name · <relative time>`.
- [ ] Telegram session subtitles read `<chat title> · <relative time>`, with no `#`.
- [ ] A session whose conversation cannot be resolved shows the time alone.
- [ ] Every session row uses relative time, including non-channel rows.
- [ ] No ambient marker appears on any row.
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

```bash
mise run check && mise run test
```

On the local dev cluster, bind an agent to two different Slack channels and one Telegram chat.
Send a message in each. Confirm the sessions sidebar shows three new rows, each with the right
messenger logo, each naming its own conversation, and that the two Slack rows are told apart by
name. Turn ambient on for one Slack channel, let it pick up a message, and confirm that session
appears with the same treatment and no ambient marker. Check that an ordinary chat session shows
a relative time and no channel name.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
