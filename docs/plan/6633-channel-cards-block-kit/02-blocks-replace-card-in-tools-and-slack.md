# 02 — `blocks` replaces `card` in the tools and Slack

**Depends on:** 01-block-check-and-text-form
**Part of:** Channel cards on Slack Block Kit — see [README](./README.md)

## Context

This is the switch itself: the tools take raw blocks, Slack posts them, and the json-render catalog and Chat SDK's Slack converter leave the codebase.
After this commit an Agent can post KPI tiles and columns to Slack.
Choice buttons stay refused until sub-issue 05, and Telegram gets the text form alone until sub-issue 03.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Worker contract** — `packages/api-server/src/modules/channels/services/worker-contract.ts`:
   `ChannelCard` becomes `{ blocks: ChannelBlock[]; text: string }`.
   Its users keep the field name `card`.
2. **Tool parameters** — `packages/api-server/src/apps/harness-api-server/mcp-endpoint.ts` and `thread-tools.ts`:
   - Replace `cardTreeSchema`, `cardInput` and `cardOf` with a `blocks` input (an array of JSON objects) and a `blocksOf` that calls `checkChannelBlocks` with `choiceButtons: "refuse"` and builds the `ChannelCard` with `channelBlocksText`.
   - Rename the parameter to `blocks` on `reply`, `post` (and its old name `send_channel_message`), `start_thread` and the tool that changes an own post.
   - The parameter description says in one sentence what blocks are for and that the text shows above them.
     It names no describe tool yet; sub-issue 04 adds the pointer.
   - A `card` argument must be refused, not dropped: "`card` is gone — send Slack Block Kit blocks in `blocks`".
     First find out how the MCP server treats an argument the schema does not declare, then pick the smallest way to refuse it that does not advertise `card` in the tool list.
   - Remove the `describe_card_components` tool and the imports from `channel-card.js`.
   - Keep the audit field `hasCard`.
3. **Artifact links** — `infrastructure/outbound-artifact-links.ts`:
   keep mapping every string of the card, which now covers `blocks` and `text`; drop the re-check that called `cardIssues`.
4. **Slack posting** — `infrastructure/slack.ts`:
   - `agentPost`: the post's blocks are the text sections, then the card's blocks, then the Agent Footer.
     The message `text` is the Agent's text joined with the card's text form.
     Remove `asText`, `cardIssues` and `cardBlocks`' dependence on `slack-card-blocks.js`.
   - `postRefusal`: count with `countChannelBlocks` so nested blocks count toward `SLACK_MAX_BLOCKS`, and keep the empty-post refusal.
   - `sendAgentPost`: remove the retry with the text form.
     When `slackRefusedBlocks(err)` holds, return a tool error through each caller's existing error path: "Slack refused the blocks: …" with the messages Slack sends in `response_metadata.messages`, and a last sentence that says nothing was posted.
     The callers are the whisper answer (near `agentPost` at the whisper reply), `post`, `reply`, the edit of an own post and the thread start.
   - A message with a file keeps its one-post rule and its own fallback (text first, file after); only the blocks' refusal changes.
   - Move `slackRefusedBlocks` next to its only user and delete `infrastructure/slack-card-blocks.ts`.
5. **Read-back** — `infrastructure/slack-post-text.ts`:
   an Agent's post is still read from its `text`, which holds the text form.
   In `blockText`, read a block type the function does not know with `channelBlocksText`, so another app's `layout` or `card` post is no longer read as empty.
6. **Telegram** — `infrastructure/telegram.ts`:
   make `telegramPayload` and `telegramCardTooLong` compile against the new `ChannelCard` by sending `card.text` as text.
   Link buttons come back in sub-issue 03.
7. **Remove the catalog** — delete `infrastructure/channel-card.ts`, `__tests__/unit/channel-card.test.ts` and `__tests__/unit/slack-card-blocks.test.ts`.
   Update the existing cases in `channel-mcp-tools.test.ts`, the Slack outbound tests and `slack-post-text.test.ts` that send or expect a card, so they send blocks.
   Do not delete a case to make the suite pass: a case whose subject is gone (the catalog, the silent retry) is removed and named in the commit body.
8. **Dependencies** — `packages/api-server/package.json`, `pnpm-workspace.yaml`, the lockfile:
   remove `@json-render/chat` and `@json-render/core`, and each `@chat-adapter/*` package no file imports any more (`@chat-adapter/telegram`, `@chat-adapter/state-pg` and `chat` stay).
   Remove the `@json-render` entries and their comment from `minimumReleaseAgeExclude`.
   Refresh the lockfile with the repository's install task (`mise tasks --all` lists it).

## Acceptance criteria

- [ ] `reply`, `post`, `start_thread` and the edit tool list a `blocks` parameter and no `card` parameter.
- [ ] A call with `card` returns an error that names `blocks`; nothing is posted.
- [ ] A call with a `layout` of two `card` blocks reaches the Slack gateway with those blocks between the text sections and the Agent Footer, and with platform `action_id`s on any button.
- [ ] When the gateway throws `invalid_blocks`, the tool returns an error with Slack's wording and the gateway receives no second call.
- [ ] A post whose text, blocks and footer count more than 50 blocks, nested ones included, is refused with its length.
- [ ] No file under `packages/` imports `@json-render/*` or `@chat-adapter/slack`.
- [ ] `git grep -n "describe_card_components" -- packages` prints nothing.

## Smoke test

```sh
mise run //packages/api-server:check
mise run //packages/api-server:test
mise run check:comment-types
git grep -n -E "@json-render/|describe_card_components|slack-card-blocks|channel-card\.js" -- packages
```

The three tasks pass and the `git grep` prints nothing.
The docs still describe the catalog after this commit; sub-issue 04 fixes them.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
