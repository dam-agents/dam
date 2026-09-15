# 05 — Agent Channels section

**Depends on:** 01-channel-name-resolution, 03-channel-vs-connection-explainer
**Part of:** UI — Slack integration discoverability — see [README](./README.md)

## Context

The agent's own Channels section is where someone manages bindings after setup. Today it shows
raw `C0…` ids, which nobody recognises, and its Telegram half looks unlike its Slack half. This
slice fixes both.

Apply the `/react-ui-engineering` skill.

## Ask for the Figma frame first

- Agent Channels section with a bound Slack channel — **view 29**

The frame shows one bound Slack channel and an empty Telegram card, so it does not cover every
state. Ask for more frames if you meet a state it does not answer.

## Implementation plan

1. **Show the channel name.** Slack rows read `#eng-frontend`, not `C0…`, using the resolution
   from sub-issue 01. An unresolved name falls back to the raw id rather than rendering blank.

2. **Rename the cards** to **"Slack Channel"** and **"Telegram Chat"**. They read "Slack" and
   "Telegram" today; the new names match the setup page.

3. **Add the `?`** to the Slack card header, using the component from sub-issue 03. The Telegram
   card gets none.

4. **Bring the Telegram rows to parity.** Slack rows use a bordered row with a title, a subtitle
   and a `⋮` overflow holding Edit and Disconnect. Telegram rows today are a title and an inline
   danger button.

   Give Telegram the same row shell and the same overflow, holding **Disconnect only** — a
   Telegram binding has no ambient mode, no default agent and nothing to edit, so there is nothing
   else to put there.

   This leaves a Telegram row with **no subtitle**, where a Slack row shows "Ambient on/off".
   Ship it empty unless the frame says otherwise. No frame covers this row — its overflow menu is
   new — so request one before building it, per the Figma-first rule, and settle the subtitle then.

5. **Keep the "Default" badge** on Slack rows. Figma does not draw it, but the frame shows a
   channel that is not a default, and the badge carries real information about which agent absorbs
   unnamed mentions. Removing it would be a silent loss.

6. **Keep the empty states.** "No chats connected yet." above the Telegram button, and the Slack
   equivalent. View 29 does not draw them because its Slack card is populated and its Telegram
   card was not drawn with one.

7. **Leave the disconnect confirmations alone.** The Slack confirmation explains what happens when
   the channel's default agent is released; that copy is correct and out of scope.

## Acceptance criteria

- [ ] A bound Slack channel shows `#name`; an unresolvable one shows its id.
- [ ] Cards read "Slack Channel" and "Telegram Chat".
- [ ] The Slack card shows the `?` explainer; the Telegram card does not.
- [ ] Telegram rows use the same shell as Slack rows, with an overflow holding Disconnect.
- [ ] Disconnect still works from both, with the existing confirmations intact.
- [ ] Empty states appear when nothing is connected.
- [ ] The "Default" badge still appears on a default Slack binding.
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

```bash
mise run check && mise run test
```

On the local dev cluster, open an agent bound to a Slack channel and a Telegram chat, and go to
its Channels section. Confirm the Slack row reads `#name` rather than `C0…`, that both cards carry
their new titles, and that the `?` appears on Slack only. Open the Telegram row's overflow and
disconnect from it; confirm the chat disappears and the empty state returns. Re-bind, then
disconnect the Slack channel through its overflow and confirm the confirmation still explains the
consequence.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
