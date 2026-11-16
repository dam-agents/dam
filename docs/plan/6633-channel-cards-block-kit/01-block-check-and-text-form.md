# 01 — Block check and text form

**Part of:** Channel cards on Slack Block Kit — see [README](./README.md)

## Context

Everything else in the feature rests on four pure functions over raw Block Kit JSON: the check, the text form, the link buttons and the block count.
This slice writes them with no caller, so the next slices only wire them in.

## Implementation plan

Apply the `/typescript-engineering` skill: this is domain code, pure, with no import from `infrastructure/` and no library for cards.

1. Create `packages/api-server/src/modules/channels/domain/channel-blocks.ts` with the exports the README's shared contract names.
   Define `ChannelBlock` here and let `services/worker-contract.ts` import it in sub-issue 02.
2. `checkChannelBlocks(input, { agentId, choiceButtons })`:
   - The input must be a non-empty array of objects that each have a string `type`; anything else is one issue that says what a block is.
   - Walk the whole tree, nested blocks included: a `layout`'s rows, items and `fallback`, a `container`'s `child_blocks`, a `carousel`'s `elements`, a `card`'s `actions`, a `section`'s `accessory`, an `actions` or `context_actions` block's `elements`.
     Walk generically over object values and arrays, so a block Slack adds later is covered without a change here.
   - Refuse an `input` block and every input element.
     The named set: `static_select`, `external_select`, `users_select`, `conversations_select`, `channels_select`, their `multi_` forms, `overflow`, `datepicker`, `timepicker`, `datetimepicker`, `checkboxes`, `radio_buttons`, `plain_text_input`, `number_input`, `email_text_input`, `url_text_input`, `rich_text_input`, `file_input`, `workflow_button`, `feedback_buttons`, `icon_button`.
     Also refuse any object that carries an `action_id` and is not a `button`: that catches an input element Slack adds later.
     The issue names the element and says a button or a question in the text does the job.
   - A `button` with a `url` is a link button: write `action_id` as `agent-button:<agentId>:<index>` and delete `value`.
   - A `button` without a `url` is a choice button.
     With `choiceButtons: "refuse"` it is an issue that says a channel cannot carry one yet and to use a link button or ask in the text.
     With `"allow"`, write the same platform `action_id` and keep the Agent's `value`, which the click hands back as data.
   - Return every issue, not the first one, the way the card check does today.
   - Return a new tree; do not mutate the input.
3. `channelBlocksText(blocks)`:
   - Collect texts in document order: a text object's `text`, a `header`, a `section`'s text and fields, a `card`'s title, subtitle, body and subtext, a `container`'s title and subtitle, a `layout`'s label when `is_label_visible` is true, a table's cells row by row joined with `|`, a chart's title and series, an image's `alt_text`.
   - For a type the function does not know, fall back to every text object found inside it, so nothing is silently lost.
   - Skip a `layout`'s `fallback`: it repeats the content.
   - A link button becomes `[label](url)`, and choice buttons of one `actions` group become one line of their labels.
   - Turn a mrkdwn link `<url|label>` into `[label](url)`; leave emphasis marks as written.
   - Move `richTextOf` from `infrastructure/slack-post-text.ts` into this module and import it back there, so rich text reads the same in both places.
4. `channelBlockLinkButtons(blocks)`: every link button in document order as `{ label, url }`.
5. `countChannelBlocks(blocks)`: top-level blocks plus every nested block, `fallback` excluded.
6. **Exception to the no-new-tests rule:** this module has no caller and no manual path yet, and its edges (nesting, the `action_id` rule, unknown types) are exactly what a manual check would miss.
   Add `packages/api-server/src/__tests__/unit/channel-blocks.test.ts` with the few cases that pin them: a nested input element is refused, an Agent-written `action_id` and a link button's `value` never survive, an unknown block type passes and its texts reach the text form, a KPI layout of two cards gives the expected text, the count includes nested blocks.

## Acceptance criteria

- [ ] `domain/channel-blocks.ts` imports nothing from `infrastructure/`, `chat`, `@chat-adapter/*` or `@json-render/*`.
- [ ] A button that goes in with `action_id: "command-menu:0"` and `value: "unbind x"` comes out with an `agent-button:` id, and with no `value` when it has a `url`.
- [ ] A block of an unknown type passes the check, and its text objects appear in the text form.
- [ ] A select inside a `section` accessory inside a `layout` item is refused with an issue that names it.
- [ ] `slack-post-text.ts` behaves as before; its existing tests pass unchanged.

## Smoke test

```sh
mise run //packages/api-server:check
mise run //packages/api-server:test
mise run check:comment-types
```

All three pass, with the new test file among the unit tests and `slack-post-text.test.ts` unchanged.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
