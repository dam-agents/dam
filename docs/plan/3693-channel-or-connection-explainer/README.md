# The Slack explainers tell a user whether they need a channel or a connection

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3693

## Goal

Agent setup offers two Slack paths. A **Slack channel** lets people chat with the agent in Slack,
and the agent posts as the bot. A **Slack connection** hands the agent the user's own Slack
account, and the agent posts as the user. Users mix them up: one added a connection expecting the
agent to post as itself.

After this change, each path's help popover says when to use it and who the agent speaks as. Each
popover links to the other path, and in agent setup that link keeps the user on the create page.

## Approach

UI copy and one link wiring, in `packages/ui` only. No contract, server or doc change.

Both popovers live in
[`channel-connection-explainer.tsx`](../../../packages/ui/src/components/channel-connection-explainer.tsx),
built on the shared `ExplainerPopover`:

| Popover | Where it shows | Its cross-link today |
|---|---|---|
| `SlackChannelExplainer` | The **Slack Channel** row in the create page's Channels section (`setup-channels-section.tsx`); the **Slack Channel** card on an agent's Channels tab (`slack-channel-card.tsx`) | "Go to Connections": opens the Connection catalogue modal in setup; switches to the agent's Connections tab on the agent page |
| `SlackAccountExplainer` | The **Slack** provider card in the Connection catalogue modal (`catalog-provider-card.tsx`), wherever that modal opens: create page, agent Connections tab, global Connections page | "Go to Channels": switches to the agent's Channels tab on the agent page; **no handler** on the create page or the global page, so it renders as grey text |

The agreed copy comes from the issue thread (Jenna Winkler's tightened version of Shane Dempsey's
proposal). `{brand}` is `getBrand().name`, never a literal (see Branding in `AGENTS.md`;
`slack-install-request.tsx` already writes the bot's name this way).

**Slack channel popover**

> Lets people chat with this agent in a Slack DM or channel. Messages come from the {brand} bot,
> signed with the agent's name.
>
> Want the agent to use your Slack access to monitor or post on your behalf? Use a Slack
> connection →

**Slack connection popover**

> Lets this agent use your Slack account to search, read, and post anywhere you can. Its posts
> come from you, not the {brand} bot.
>
> Want people to chat with the agent in Slack? Add a Slack channel →

Two decisions the user made during planning:

- **No-agent wording.** Where the catalogue has no agent (the global Connections page), the
  connection popover says "Lets an agent use your Slack account…" and "Want people to chat with an
  agent in Slack?". Everywhere else it uses "this agent" / "the agent" as above.
- **"Add a Slack channel →" on the create page** closes the Connection catalogue modal and moves
  focus to the **Slack Channel** checkbox in the Channels section. It does **not** tick the
  checkbox. This matches the agent page, where the same link only switches to the Channels tab.
  The link is live only where that row exists: the plain create path (not a starter kit) on an
  install that offers Slack. Elsewhere it stays grey text, as today.

The copy is true to the system: every bot post carries a footer naming the agent, and posts made
through the owner's Slack Account connection carry none
([slack-guarantees](../../architecture/slack-guarantees.md), §2 "Reach: bot vs. owner's account";
[channels](../../architecture/channels.md), "Agent persona on posts").

## Conventions & glossary

- **Slack channel** — a binding that puts the agent in a Slack conversation; posts come from the
  bot. In setup it is the **Slack Channel** checkbox row; the bind walkthrough runs after create.
- **Slack connection** — the Slack Account connection from the Connection catalogue; the agent
  acts as the person who made it.
- Renaming **Channel** or **Connection** is out of scope (#3542), as are the identity signals in
  the catalogue and after setup (#3316, shipped). Keep the popovers' `aria-label`s, the row
  descriptions and the section labels as they are.
- Telegram needs no change: no Telegram connection acts as the person.
- Apply `/react-ui-engineering`. Follow `docs/guidelines/comment-guidelines.md`; the change needs
  no new comments.

## Whole-feature smoke test

Same as sub-issue 01's smoke test: the feature is one slice.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3693.

The issue's last "Done when" item, "The revised copy is applied in the agent setup designs", is
Figma work for the designers. The PR does not cover it; say so in the PR.
