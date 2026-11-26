# Agent posts in Slack point people to `/dam`

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/6561

## Goal

People who see an agent in Slack do not learn that `/dam` exists.
The bare slash command opens a private menu: every agent in the conversation, the words that reach each one, Whisper, and, for the person who owns or connected an agent, that agent's settings.
In a channel, a person meets the command name mostly in error messages.

After this feature:

- Every agent post that other people can see, in a channel or a group DM, ends with a hint after the "Sent by" link: "Run `/dam` to see every agent here or whisper to one".
- A 1:1 DM and a private answer to a whisper get no hint, because their only reader already reached the agent.
- The notice that the app posts when an agent joins a conversation gives the exact words that reach the agent.
  The words are `@DAM` alone when the agent is the default agent, and `@DAM <Name>` when another agent is the default, which the notice then names.
- In a 1:1 DM the notice says how to change or disconnect the agent with `/dam`.

`/dam` and `@DAM` in this plan stand for the install's `/${brand.short}` and `@${brand.name}`.
Never hard-code them.

A clickable mockup of both Slack looks, before and after, with the `/dam` menu as a member and as an owner: https://claude.ai/artifact/FJT8D8SbwaekYa8meE9Lyh (private; ask Petr for access).

## Approach

Read these pages first:

- [channel-turns › The Agent Footer](../../architecture/channel-turns.md#the-agent-footer): the footer's link is a contract, its label is presentation.
- [slack-commands](../../architecture/slack-commands.md): the menu that `/dam` opens.
- [channels](../../architecture/channels.md): the default Agent, and posts by Agents and apps.
- [slack-guarantees](../../architecture/slack-guarantees.md): it states what every connect notice and every post's footer do, so both slices update it.

The facts that both slices rest on:

1. **An agent post has two looks, and the footer is the same in both.**
   The `chat:write.customize` scope decides the look (`signsAgentPosts` and `agentPersona` in [`slack.ts`](../../../packages/api-server/src/modules/channels/infrastructure/slack.ts)).
   Without the scope, or when the scopes are unknown, the app is the poster and the text opens with the agent's emoji and bold name.
   With the scope, Slack shows the agent's name and avatar as the poster.
   A file-only post in the first look has no name line, so its footer is the only place that names the agent.
   The hint is in the footer, so it looks the same in both.
2. **The Agent Footer is one `context` block with one `mrkdwn` element, and it is the last block of the post** ([`agent-footer.ts`](../../../packages/api-server/src/modules/channels/infrastructure/agent-footer.ts)).
   The hint is text after the link, in that same element, separated by ` · `.
   Three rules follow:
   - **Same element.** `renderSlackPostText` in [`slack-post-text.ts`](../../../packages/api-server/src/modules/channels/infrastructure/slack-post-text.ts) drops a context block that holds a footer link, so agents never read the hint.
     A hint in a block of its own would reach every agent's history and `read_thread`, which is the class of problem #6500 had with the name header.
   - **Last block.** `closingBlock` reads who wrote a post from the last block only.
   - **Link and label unchanged.** `parseAgentFooter`, `footerSessionId`, `footerMarksAmbientRound` and the companion apps of other installs parse the link with unanchored patterns, so text after the link does not break them.
     The hint is mrkdwn and must not go through `escapeLinkLabel`.
3. **The connect notice is an agent post.**
   `announceSlackConnect` in [`agents-service.ts`](../../../packages/api-server/src/modules/agents/services/agents-service.ts) posts through `SlackBindingPort.postMessage`, which [`context.ts`](../../../packages/api-server/src/apps/api-server/trpc/context.ts) wires to `channelManager.postMessage`.
   That reaches the Slack worker's `postMessage`, the same path as the agent's `post` tool.
   So the notice has the agent's name at the top and the Agent Footer, and after 01 also the hint.
   An agent's post that tags the app routes like a person's mention ([slack-guarantees](../../architecture/slack-guarantees.md)).
   So the notice writes `@DAM` as code text, never as a live `<@U…>` mention, or the notice could start a turn for the default agent.
4. **What the `/dam` menu lets each person do** (`commandMenu` and `commandMenuState`).
   Everyone sees every agent, its owner, its role and the words that reach it, Whisper where the owner allows whispers, Add an agent, Ignored apps (read only), All commands, and Log in.
   Settings (Make default, ambient, history, Allow whispers, Delete one of its posts, Disconnect) show only to a linked person who owns or connected that agent.
   So the hint promises only what everyone gets.
5. **The default agent.**
   A new binding claims the default when the conversation has none (`claimDefaultIfVacant`), not only when it is the first binding.
   A mention with no agent name reaches the default agent.
6. **Brand.**
   The menu writes the mention as `` `@${brand.name}` `` and the command as `` `/${brand.short}` `` (`agentText` and `footnote` in [`slack-command-menu.ts`](../../../packages/api-server/src/modules/channels/infrastructure/slack-command-menu.ts)).
   The hint and the notice use the same two values.

## Where this plan differs from the issue

The issue has a "Proposed solution" and an open question, and no "Done when".
Petr decided the points below while the plan was made, on 2026-11-26.
The acceptance criteria in 01 and 02 stand in for "Done when".
The draft PR's `author-decisions` block carries the same list, so the review does not flag these points.

1. **The footer keeps "Sent by <name>".**
   The issue asks if its line replaces the footer.
   The hint joins the footer after the link instead.
   The issue's line opens with the agent's name, which "Sent by <name>" already gives, and the link is a contract.
2. **The hint says "Run `/dam` to see every agent here or whisper to one".**
   The issue says "Send `/dam` to see every agent here, whisper to one, or change settings".
   "Run" is the verb that all slash-command copy uses.
   A person who neither owns nor connected an agent can change no setting in the menu, so "change settings" is false for most readers.
3. **No hint in a 1:1 DM or in a private answer to a whisper.**
   The issue says "every agent post".
   The only reader of these posts already reached the agent, and "whisper to one" has no meaning in a 1:1 DM.
   Whisper threads live in the person's DM with the app, so they get no hint either.
4. **The notice gives the words that reach this agent.**
   The issue says "Send `@DAM` to ask it something".
   The notice says "Send `@DAM` to talk to it" only when the new agent is the default agent.
   Otherwise it names the default agent and says "Send `@DAM <Name>` to talk to it", because `@DAM` alone reaches the default.
   The wording matches the menu's "Send `@DAM …` to talk to this agent".
5. **The notice's `/dam` line comes from its footer in channels and group DMs.**
   The issue says the notice carries the same `/dam` line.
   The notice is an agent post, so its footer already carries the hint, and the text does not repeat it.
   A 1:1 DM has no footer hint, so there the text says "Run `/dam` to change its settings or disconnect it".
   The person in a 1:1 DM is the person who connected the agent, so the menu lets them change it.
6. **The notice drops "run the unbind command to disconnect".**
   The sentence names no command, and Disconnect is in the menu.
7. **`@DAM` in the notice is code text, not a live mention.**
   See fact 3.
8. **Slack only.**
   Telegram does not change.

## Sub-issues

| #   | Title                                              | Scope                                                                                                                              | Depends on |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 01  | The `/dam` hint in the Agent Footer                | The hint after the footer link on agent posts in channels and group DMs, never in a 1:1 DM or a private answer; docs               | —          |
| 02  | The connect notice says how to reach the new agent | New notice copy for the default agent, another default and a 1:1 DM; the brand and the default agent's name reach the notice; docs | 01         |

## Conventions & glossary

- **Agent Footer**: the last block of an agent post, a link labeled "Sent by <name>" after the agent's emoji.
- **Hint**: the text that this feature adds after the footer link.
- **Connect notice**: the post that the app makes, as the agent, when the agent joins a conversation from `/dam bind`, the UI, the CLI or a Starter Kit.
- **Default agent**: the agent that a mention with no agent name reaches.
- **1:1 DM**: a conversation id that starts with `D` (`isDirectMessageId`).
  A group DM is not a 1:1 DM and gets the channel behavior.
- **Private answer**: the ephemeral answer to a quoted whisper (`postEphemeral` in the whisper path), which only the whisperer sees.
- Copy: "Run `/dam` …" for the slash command, "Send `@DAM …` to talk to …" for a mention, as the menu does.
- Apply the `/typescript-engineering` skill.
  No slice touches `packages/ui`.
- Comments follow [comment-guidelines](../../guidelines/comment-guidelines.md); run `mise run check:comment-types`.
- Docs follow [documentation-guidelines](../../guidelines/documentation-guidelines.md): one sentence per line (`mise run fix:markdown`), bump `Last verified`, describe behavior rather than exact copy, and never link an ADR.
- No new tests.
  Update the existing assertions that quote copy this plan changes; each slice names the files that it knows of.
- The QA profile (`.quality-inspector/qi-profile-dam/`) has no journey that reads Slack posts, and the Design Desk profile covers only `packages/ui`, so neither changes.
  Confirm with a grep before the PR.
- The PR changes no web UI, so it needs no UI proof.
  A Slack screenshot of each notice and of a post with the hint helps the reviewer.

## Whole-feature smoke test

On the local cluster with Slack wired (the [`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md) skill; a worktree install needs the Slack Helm values passed in):

1. Install the branch build.
2. In a test channel with no agent, run `/dam bind` and pick agent A.
   The notice says "Send `@DAM` to talk to it", and its footer ends with the hint.
3. Run `/dam bind` again and pick agent B.
   The notice names A as the default agent and says "Send `@DAM B` to talk to it".
   A starts no session from the notice.
4. Mention A.
   The reply's footer reads "Sent by A · Run `/dam` to see every agent here or whisper to one".
5. Run `/dam` as a person who owns neither agent.
   The menu shows both agents with Whisper and no settings.
6. Run `/dam whisper A "a question"`.
   The private answer has no hint.
7. In your DM with the app, run `/dam bind` and pick agent A.
   The notice says "Run `/dam` to change its settings or disconnect it", and A's replies in the DM have no hint.
8. `mise run check` and `mise run test` pass.

The dev Slack app grants every manifest scope, so it shows the "agent as poster" look.
The existing persona unit tests cover the other look.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/6561.
