# 04 — `describe_blocks` and the docs

**Depends on:** 02-blocks-replace-card-in-tools-and-slack
**Part of:** Channel cards on Slack Block Kit — see [README](./README.md)

## Context

Models know the older Block Kit blocks, but `layout`, `card`, `container` and `carousel` arrived in 2026 and are not in their training.
Without a reference an Agent reaches a KPI layout only through rounds of Slack errors.
This slice gives the Agent an on-demand tool with the platform's rules and a short reference, and brings the architecture docs in line with what sub-issue 02 built.

## Implementation plan

Apply the `/typescript-engineering` skill to the code, and [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md) to the docs.

1. **The reference** — a new file beside the MCP endpoint, `packages/api-server/src/apps/harness-api-server/block-reference.ts`, that exports the reference as data: one entry per block with a one-line purpose, its fields with their limits, and one minimal example.
   Cover `layout`, `card`, `container`, `carousel`, `table`, the chart block, and one line each for `header`, `section`, `context`, `divider`, `image`, `actions` with a link button.
   Include two worked examples, because they are what the issue asks for: three KPI tiles in one `layout` row, and a chart beside a text panel (the chart takes more than half of its row).
   Run every example through `checkChannelBlocks` in an existing or new unit case, so an example the platform itself would refuse cannot ship.
   Take every field and limit from Slack's reference pages, read on the day of the change, and do not write one from memory:
   - https://docs.slack.dev/reference/block-kit/blocks/layout-block
   - https://docs.slack.dev/reference/block-kit/blocks/card-block
   - https://docs.slack.dev/reference/block-kit/blocks/container-block
   - https://docs.slack.dev/reference/block-kit/blocks/carousel-block
   - the table and data-visualization pages under https://docs.slack.dev/reference/block-kit/blocks
2. **The tool** — `mcp-endpoint.ts`: add `describe_blocks`, on demand like the tool it replaces.
   It returns the format (raw Slack Block Kit blocks under the message text), the platform's rules (what is refused and why, that the platform writes button ids, the 50-block cap with nested blocks counted, that a Slack refusal comes back as an error and nothing posts), what each messenger shows (Slack the blocks, Telegram the text form with link buttons), and the reference.
   Say that the reference is a starting point and that any other Block Kit block is allowed.
   Point to it from the `blocks` parameter descriptions in `mcp-endpoint.ts` and `thread-tools.ts`, and from the error a refused card returns.
3. **Architecture page** — rewrite `docs/architecture/channel-cards.md` for the new design: what a Channel Card is, how an Agent sends one, the check, rendering in Slack and Telegram with the sequence diagram updated (no retry with the text form), the text form, and that no card library remains.
   Update `Last verified:`.
4. **Other docs:**
   - `docs/ubiquitous-language.md`: redefine "Channel Card" as the Block Kit part of an Agent post, with a derived text form.
   - `docs/architecture/slack-guarantees.md`: the outbound tools line that names `describe_card_components`, and the table row that says a refused card goes out as its text form.
   - `docs/architecture/slack-edits.md`: the sentence on a card in an edit still holds; check its wording against the new check.
   - `docs/architecture.md`: the one-line summary of the channel-cards page.
5. Keep every page under the size cap, and write no ADR reference.

## Acceptance criteria

- [ ] `describe_blocks` is in the tool list of the per-Agent MCP endpoint and returns rules and a reference that includes both worked examples.
- [ ] Every example in the reference passes `checkChannelBlocks`.
- [ ] The `blocks` parameter description and the refused-card error name `describe_blocks`.
- [ ] `git grep -n -i -E "json-render|describe_card_components" -- docs/architecture docs/ubiquitous-language.md` prints nothing.
- [ ] `channel-cards.md` describes no component catalog and no retry with the text form.

## Smoke test

```sh
mise run //packages/api-server:check
mise run //packages/api-server:test
mise run check:markdown
mise run //docs:check:doc-size
mise run check:comment-types
```

All pass.
Manual, on the local cluster: in an Agent's web chat, ask it to call `describe_blocks` and to say which blocks it lists; the answer names `layout` and `card`.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
