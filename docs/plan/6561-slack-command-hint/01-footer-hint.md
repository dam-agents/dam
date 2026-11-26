# 01 — The `/dam` hint in the Agent Footer

**Part of:** Agent posts in Slack point people to `/dam` — see [README](./README.md)

## Context

This slice adds the hint "Run `/dam` to see every agent here or whisper to one" after the "Sent by" link of every agent post that other people can see.
That means posts in a channel or a group DM: replies, `post` tool posts, card posts, file-only posts and edited posts.
A post in a 1:1 DM and the private answer to a whisper keep today's footer.
The README's facts 1, 2 and 6 set the rules: the hint is text in the footer's one `mrkdwn` element, the footer stays the last block, the link and its label do not change, and the command name comes from `brand.short`.
The connect notice goes through the `post` path, so it gets the hint from this slice with no extra work.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. In [`agent-footer.ts`](../../../packages/api-server/src/modules/channels/infrastructure/agent-footer.ts):
   - Add an optional `hint` (mrkdwn text) to `AgentFooter`.
   - In `agentFooterMrkdwn`, when `hint` is set, put ` · ` and the hint after the closing `>` of the link.
     Do not pass the hint through `escapeLinkLabel`; it holds backticks on purpose.
   - Add the copy next to `agentFooterLabel`, as a function of `brand.short`: ``Run `/${brandShort}` to see every agent here or whisper to one``.

2. In [`slack.ts`](../../../packages/api-server/src/modules/channels/infrastructure/slack.ts), change `agentFooter` (near line 2950) so that it can set `hint`.
   It needs to know the conversation the post goes to and whether the post is private.
   An options object reads better than a fourth positional parameter.
   Set the hint only when the conversation is not a 1:1 DM (`!isDirectMessageId(id)`) and the post is not private.
   Take the command name from the worker's `brandShort`.

3. Update the four callers of `agentFooter`:
   - The private answer to a quoted whisper (`postEphemeral`, near line 3583): no hint.
   - The `post` method (near line 9241): hint by `target.id`.
     This path also posts the connect notice.
   - The reply path (near line 9605), including the file-only branch where the footer rides on the file: hint by `target.id`.
   - The edit path (near line 9743): hint by `target.id`, so an edited post in a channel gets the hint.

   Then grep for `agentFooter(` and `agentContextBlock(` (also `renderAssistantBlocks` in `slack-turn-presenter.ts`) to confirm that no other place builds a footer.

4. Docs (one sentence per line, bump `Last verified`, describe behavior rather than exact copy):
   - [channel-turns › The Agent Footer](../../architecture/channel-turns.md#the-agent-footer): after the label paragraph, say that a post that other people can see also points at the command menu after the link.
     Say why the pointer sits in the footer's own element: agents never read that block, and a block of its own would reach their history.
     Say that a 1:1 DM and a private answer get no pointer, because their reader already reached the Agent.
   - [slack-commands](../../architecture/slack-commands.md): add how people find the menu: the footer of each agent post that others see names the command.
   - [slack-guarantees](../../architecture/slack-guarantees.md): the line "Every post carries a footer naming the Agent …" also says that in channels and group DMs the footer names `/dam`.

5. Run the api-server suite and update existing assertions that quote a whole footer of a channel post.
   Known files: `slack-turn.test.ts` (the `Sent by an agent` context texts near lines 451 and 470).
   Others that quote "Sent by" may also need the new text: `slack-agent-persona.test.ts`, `slack-bot-posts.test.ts`, `slack-post-edits.test.ts`, `slack-owned-threads.test.ts`, `slack-thread-visibility.test.ts`, `slack-thread-peer-visibility.test.ts`, `slack-cross-agent-history.test.ts`.
   The unit tests of `agentFooterMrkdwn` without a hint stay as they are.
   Add no new tests.

## Acceptance criteria

- [ ] A reply, a `post` tool post, a card post, a file-only post and an edited post in a channel or a group DM end with one `context` block.
  Its one `mrkdwn` element holds the emoji, the unchanged "Sent by <Name>" link, ` · `, and "Run `/dam` to see every agent here or whisper to one", with `dam` taken from `brand.short`.
- [ ] The same kinds of post in a 1:1 DM, and the private answer to a quoted whisper, have the footer of today, with no hint.
- [ ] The footer stays the last block of every post, and its link URL and label do not change.
- [ ] The post's top-level `text` (the notification text) does not change, and `renderSlackPostText` returns no hint for a post that has one.
- [ ] The command name comes from `brand.short`; no literal brand is added to code.
- [ ] `channel-turns.md`, `slack-commands.md` and `slack-guarantees.md` describe the hint, with `Last verified` bumped.
- [ ] `mise run //packages/api-server:check`, `mise run //packages/api-server:test`, `mise run check:comment-types` and `mise run fix:markdown` pass, with no new test added.

## Smoke test

Run the suites that cover the footer and its parsers:

```bash
mise run //packages/api-server:test -- src/__tests__/unit/slack-agent-footer.test.ts src/__tests__/unit/slack-turn.test.ts src/__tests__/unit/slack-cross-agent-history.test.ts src/__tests__/unit/slack-post-edits.test.ts
```

Then the whole package: `mise run //packages/api-server:test` and `mise run //packages/api-server:check`.

On the local cluster with Slack wired, after installing the branch build:

1. In a test channel with an agent connected, mention the agent.
   Its reply's footer reads "Sent by <Name> · Run `/dam` to see every agent here or whisper to one".
2. Ask the agent to post a file only.
   The file message carries the same footer.
3. Run `/dam whisper <Name> "a question"`.
   The private answer's footer has no hint.
4. In your DM with the app, with the agent connected there, send a message.
   The reply's footer has no hint.
5. Ask another agent in the channel to summarize the thread.
   Its answer does not quote the hint.

The implementing agent runs these itself, then prints a short manual smoke-test guide for the user.
