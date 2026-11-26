# 02 — The connect notice says how to reach the new agent

**Depends on:** 01-footer-hint
**Part of:** Agent posts in Slack point people to `/dam` — see [README](./README.md)

## Context

When an agent joins a conversation, the app posts a notice as that agent.
Today the notice says how many agents are already there and "run the unbind command to disconnect", which names no command.
It does not say which words reach the new agent, so a person in the channel cannot use it at once.
This slice gives the exact words, from the same form that the `/dam` menu uses, and names the default agent where the new one is not the default.
In channels and group DMs the notice's footer carries the hint from 01, so the text does not repeat it.
In a 1:1 DM, which has no hint, the text points at `/dam` itself.
The README's facts 3, 5 and 6 and its points 4 to 7 under "Where this plan differs from the issue" set the rules.

## Implementation plan

Apply the `/typescript-engineering` skill.
All copy below is standard Markdown, because the notice goes out as an agent post through the `markdown` block: bold is `**…**`, and each line is its own paragraph (a blank line between lines) so that Slack shows it on its own line.
`@DAM` stands for `` `@${brand.name}` `` and `/dam` for `` `/${brand.short}` ``, both as code text.

1. In [`agents-service.ts`](../../../packages/api-server/src/modules/agents/services/agents-service.ts), rewrite `slackConnectNotice` (near line 392).
   It takes the agent's name, the conversation id, the Slack user who connected the agent, whether the new binding is the default, the default agent's name when that is another agent, and the brand.
   It no longer takes `alreadyHere`.
   The copy for each case follows; each line in a block is one paragraph of the post.
   - **Channel or group DM, the new agent is the default:**

     ```text
     This channel is now connected to **Damathy**, owned by <@U…>. Everyone here can use it.
     Send `@DAM` to talk to it.
     ```

   - **Channel or group DM, another agent is the default.**
     When the default agent cannot be found, leave out the sentence that names it.

     ```text
     This channel is now connected to **Scout**, owned by <@U…>. Everyone here can use it.
     Send `@DAM Scout` to talk to it. `@DAM` with no name goes to Damathy, the default agent here.
     ```

   - **1:1 DM (`D…`), the new agent is the default:**

     ```text
     This DM is now connected to **Damathy**. Message it here, no mention needed.
     Run `/dam` to change its settings or disconnect it.
     ```

   - **1:1 DM, another agent is the default.**
     The first line uses the words of the DM Bridge's hello (`slackDmHello`).

     ```text
     This DM is now connected to **Scout**. Start your message with Scout to reach it.
     Run `/dam` to change its settings or disconnect it.
     ```

   - The owner stays a live `<@U…>` tag, as today.
     The app's name is never a live `<@U…>` mention: the notice is the agent's own post, and an agent post that tags the app routes like a mention.

   - The sentence "run the unbind command to disconnect" goes.

2. Read whether the new binding is the default, and the default agent's name, after the connect has committed.
   Write one helper inside `createAgentsService` and use it from all three paths, so that they cannot drift apart.
   - `deps.findSlackBindings(slackChannelId)` returns each binding's `agentId` and `isDefault`.
   - The default agent belongs to another owner, so read its name with `deps.repo.get(defaultAgentId)` and no owner argument, and use only the name.
     The `/dam` menu already shows every agent's name to everyone in the conversation, so this exposes nothing new.
   - A new binding claims the default when the conversation has none (`claimDefaultIfVacant`), so the copy must follow `isDefault`, not a count of the agents that were there before.

3. Give the agents service the brand.
   Add `brand: { name: string; short: string }` to the deps of `createAgentsService`, and pass `config.brand` through [`context.ts`](../../../packages/api-server/src/apps/api-server/trpc/context.ts) and [`modules/agents/compose.ts`](../../../packages/api-server/src/modules/agents/compose.ts).
   Update the test helper `src/__tests__/helpers/agents-service-stub.ts` so that it compiles.
   Grep for every other `createAgentsService(` call.

4. Use the new notice on the three paths that post it:
   - `executeSlackBind`, the in-chat `/dam bind` (near line 520).
     Widen its `findChannelBindings` type, or hand it the helper from step 2.
   - `connectSlack`, the connect from the UI or the CLI (near line 2135).
   - The `announceSlackConnect` service method (near line 2145), which Starter Kits call from `kit-apply-existing.ts` and `starter-kits-service.ts`.

   On each path, keep the security log entry `channel.chat_bound.notify_failed` when the post fails.

5. Docs (one sentence per line, bump `Last verified`):
   - [slack-guarantees](../../architecture/slack-guarantees.md): the line "Every connect … posts one notice in the conversation …" also says that the notice gives the words that reach the new Agent and names the default where that is another Agent.
     It also says that in a 1:1 DM the notice points at `/dam` to change or disconnect the Agent.
   - [channels](../../architecture/channels.md), near the default Agent paragraphs: add what the connect notice tells the conversation.
     Add why it names the app as text and never as a mention: the notice is the Agent's own post, and a tag of the app in an Agent's post routes like a person's mention.

6. Update the existing assertions on the old copy, and add no new tests.
   Known: `src/__tests__/unit/slack-bind.test.ts` (the "alongside one agent" and "Start a mention with an agent's name" checks near line 120, and the checks near line 78).
   Grep the api-server tests for "now connected", "unbind command" and "alongside" to find others.

## Acceptance criteria

- [ ] The in-chat `/dam bind`, the connect from the UI or the CLI, and a Starter Kit apply all post the new notice.
- [ ] In a channel where the new agent becomes the default, the notice says "Send `@DAM` to talk to it", also when an earlier default was disconnected and other agents are still there.
- [ ] In a channel where another agent is the default, the notice names the default agent and says "Send `@DAM <Name>` to talk to it".
- [ ] In a 1:1 DM the notice says "Run `/dam` to change its settings or disconnect it", and it tells the person to start with the agent's name when the agent is not the default there.
- [ ] The notice in a channel or a group DM carries the hint from 01 in its footer and does not repeat it in its text; the notice in a 1:1 DM has no footer hint.
- [ ] The notice holds no live mention of the app, and no "unbind command" text.
- [ ] `@DAM` and `/dam` come from `brand.name` and `brand.short`; no literal brand is added to code.
- [ ] The notice of a second agent starts no turn for the default agent.
- [ ] `slack-guarantees.md` and `channels.md` describe the notice, with `Last verified` bumped.
- [ ] `mise run //packages/api-server:check`, `mise run //packages/api-server:test`, `mise run check:comment-types` and `mise run fix:markdown` pass, with no new test added.

## Smoke test

Run the bind suite and the whole package:

```bash
mise run //packages/api-server:test -- src/__tests__/unit/slack-bind.test.ts
```

Then `mise run //packages/api-server:test` and `mise run //packages/api-server:check`.

On the local cluster with Slack wired, after installing the branch build:

1. In a test channel with no agent, run `/dam bind` and pick agent A.
   The notice says "Send `@DAM` to talk to it", and its footer ends with the hint.
2. Run `/dam bind` again and pick agent B.
   The notice names A as the default agent and says "Send `@DAM B` to talk to it".
   A's session list shows no new session from that notice.
3. Disconnect A with the `/dam` menu, then connect agent C from the UI.
   C becomes the default, and its notice says "Send `@DAM` to talk to it".
4. In your DM with the app, run `/dam bind` and pick agent A.
   The notice says "Run `/dam` to change its settings or disconnect it", and its footer has no hint.

The implementing agent runs these itself, then prints a short manual smoke-test guide for the user.
