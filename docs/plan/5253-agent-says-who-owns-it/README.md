# An agent can say who owns it

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/5253

## Goal

People in a shared Slack channel ask an Agent who owns it.
Today the Agent cannot see its owner, so it guesses from clues: who set it up, who installs its skills, whose name is on the issues it opens.
The guess can be right, but people see that it is a guess, and the clues tell them whose accounts the Agent runs on.

After this change, every channel turn tells the Agent its owner's display name.
On Slack, the turn also gives the Slack user that the owner linked in that workspace.
When someone asks who owns the Agent, it answers with confidence.
It also names the person who can allow a host, change its mode or turn it back on.

The same turn tells the Agent that its owner has no extra authority in the conversation.
The platform already enforces that rule: a channel turn never checks who sent the message.
The instruction keeps the Agent from treating its owner's messages differently once it can recognise them.

The answer discloses the owner's display name, which the Public Agent Page already shows for a bound Agent, and the Slack user that the owner linked.
It discloses nothing else: no email, no Connections, no accounts, no budgets.

## Approach

Read these architecture pages first:

- [channel-turns](../../architecture/channel-turns.md): the per-turn contract, and the rule that a channel turn resolves no sender identity.
- [channels](../../architecture/channels.md): identity links (`/platform login`) and shared access.
- [public-agent-page](../../architecture/public-agent-page.md): the owner's display name, and why it is never the email.

### Where the facts go

The facts go into the **per-turn contract**: the block of instructions that each Slack and Telegram turn carries with its message.
The contract already tells the Agent who it is in the conversation: the bot's identity, the Agent's own signed name, and the other Agents in the conversation.
The owner is the same kind of fact.

The plan adds no MCP tool for this.
The failure in the issue is an Agent that guessed when it should have looked something up, and a tool repeats that risk.
Also, the harness MCP server has no route to the identity directory or to the identity links today, and a tool call does not know which Slack workspace the turn is in.

### Where each fact comes from

Each lookup exists today:

| Fact          | Source                                                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owner         | The Agent's owner: `getInstanceOwner` in the Slack worker, `ownerOf` in the Telegram worker.                                                                                                                                                                                         |
| Display name  | The identity directory's `resolveDisplayNameBySub`, which the Public Agent Page uses. It is first and last name from Keycloak, cached for 60 s. `null` means "no name on record".                                                                                                    |
| Slack user id | The owner's identity links for provider `slack` (`identityLinks.externalLinksOf`). Use a link only if it was recorded in the turn's workspace. A legacy link with no workspace counts only when the install has exactly one active Slack workspace, the rule `notifyPerson` applies. |

### The decisions

The user made these decisions while the plan was discussed:

1. **Delivery.** The owner block goes into the contract of each channel turn: the Slack addressed turn, the Slack ambient round and the Telegram turn.
   UI chat does not get it, because only the owner can open it.
   Schedules do not get it, and there is no MCP tool.
2. **Slack user id.** Give it only for the turn's workspace, and leave it out when no link matches.
   The Agent says the owner's name.
   It tags the owner (`<@U…>`) only when the person asking wants to reach them, because a tag notifies the owner.
3. **No name on record.** Do as the Public Agent Page does: name nobody, not even by Slack tag.
   The Agent says that it does not know.
   In every case, the Agent never works out its owner from other clues (who set it up, whose accounts or Connections it uses, who installs its skills, whose name is on what it posts), and it does not offer those clues.
4. **Telegram.** Display name only.
5. **No extra authority.** The rule goes into every channel turn, DMs included.
   A message from the owner gets the same treatment as any other message, even when its speaker label shows the owner.
   A bound DM is not always with the owner, and the platform checks no sender there either.
   The owner directs the Agent through its instructions file and the platform UI, not through channel messages.

The user made these decisions during implementation:

6. **Session view.** The UI hides the `<agent-owner>` block, as it hides the other contract blocks.
   The same change also hides `<permission-check>`, which the hide list missed when that block was added.
   The PR carries a screenshot of the session view.
7. **Slack guarantees.** `slack-guarantees.md` changes in the same PR: §3 lists the owner block among what every Slack turn carries, and §4 gets a row for an Agent that says it does not know who owns it.

### Failure behaviour

A failed lookup never fails a turn.
A failed or slow name lookup gives the "no name on record" block, as a failed lookup on the Public Agent Page omits the owner line; the directory's user lookup is bounded by a short timeout.
A failed identity-link lookup keeps the name and leaves out only the Slack tag (decided during implementation).
Each failure is logged with the Agent id.
`resolveAgentDisplayName` in the Slack worker already follows this pattern.

### Composition

The channels module must not import the identity directory from the agents module.
`bootstrap.ts` passes a function `(sub) => display name or null` into both workers, as it passes `getInstanceOwner` and `isTermsAccepted` today.
The new dependency is required, as the `/typescript-engineering` skill requires (decided during implementation).
A missing wiring is then a type error, not an Agent that silently names nobody.
Each test set-up that builds a worker passes `async () => null`.

## Conventions & glossary

- **Owner**: the Agent's owner, a Keycloak sub.
  Channel turns run on this person's credentials.
- **Display name**: first and last name from the identity directory, never the email.
- **Owner block**: the new self-delimited block in the turn contract, beside `<network-access>` and `<permission-check>`.
  The other blocks say "your owner"; the owner block says who that person is.
- **Engineering skill**: apply `/typescript-engineering` (server-side TS, the channels module and `bootstrap.ts`).
- **Copy style**: the contract speaks to the model in plain second-person sentences.
  Match the existing blocks in `slack-turn-copy.ts`, `network-access-copy.ts` and `permission-check-copy.ts`.
- **Comments**: none, except typed comments ([comment guidelines](../../guidelines/comment-guidelines.md)).
  Run `mise run check:comment-types`.
- **Tests**: add no new tests.
  Update an existing assertion only where the changed copy breaks it.

## Whole-feature smoke test

The feature is one sub-issue, so its smoke test in [01](./01-agent-names-its-owner.md#smoke-test) is the whole-feature smoke test.
In short: on the local dev cluster with Slack configured, mention a bound Agent with "who owns you?".
The reply names the owner's display name and does not tag the owner.
The turn's prompt in the session file on the pod has the `<agent-owner>` block, and the session view in the UI does not show it.

## Sub-issues

| #                                   | Sub-issue                                  | Done |
| ----------------------------------- | ------------------------------------------ | ---- |
| [01](./01-agent-names-its-owner.md) | The agent names its owner on channel turns | [x]  |

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/5253.
