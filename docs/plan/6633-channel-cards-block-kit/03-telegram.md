# 03 — Telegram

**Depends on:** 02-blocks-replace-card-in-tools-and-slack
**Part of:** Channel cards on Slack Block Kit — see [README](./README.md)

## Context

Telegram has no Block Kit.
A person who asks in Telegram still gets the answer: the text form, with each link button as a Telegram button, as a card's link buttons arrive today.
Sub-issue 02 left Telegram with the text alone; this slice brings the buttons back.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. `packages/api-server/src/modules/channels/infrastructure/telegram.ts`, `telegramPayload`:
   when the message has a card, build the Chat SDK card the Telegram adapter posts from the Agent's text, then the card's text form, then one actions row of link buttons from `channelBlockLinkButtons(card.blocks)`.
   With no link button, send the text as today's text-only path does, so the message is not wrapped in a card for nothing.
   Keep the order the page describes: the Agent's text first.
2. A link button already shows as `[label](url)` in the text form.
   Remove those lines from the text sent to Telegram when the same button is sent as a Telegram button, so a link does not show twice.
3. `telegramCardTooLong`: measure the text that is really sent, after step 2, against the message limit and the caption limit beside a file.
4. Update the card cases in `__tests__/unit/telegram-outbound.test.ts` to send blocks.

## Acceptance criteria

- [ ] A message with a link button in its blocks reaches the Telegram adapter with that button as a card link button and without its `[label](url)` line in the text.
- [ ] A message whose blocks hold no link button is sent as text.
- [ ] A text and text form longer than one Telegram message are refused with the length, as before.

## Smoke test

```sh
mise run //packages/api-server:check
mise run //packages/api-server:test
```

Both pass, `telegram-outbound.test.ts` included.
Manual, when a Telegram chat is connected on the local cluster: ask the Agent there for a status with a link button; the status arrives as text and the button as a Telegram button.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
