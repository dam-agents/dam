# 08 — `/dam approvals` lists everything, and turns cards off

**Depends on:** 07-subagent-questions
**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Context

Cards are a push, and not every request gets one: the timing rule skips an owner who is active in the web UI, a card shows at most 10 rows, a dismissed host gets no row, and some types have no card.
`/dam approvals` is the pull: a private list of everything that waits for the caller, the same set the web approvals bell shows, wherever the request started.
A request type that has a card renderer gets its buttons or form in the list; any other type gets a one-line summary and "Open in app".
The same command also turns the cards off and on for the caller: today the only way to stop them would be `/dam logout`, which also removes the link the other commands need.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Command.** Add `approvals` to the `/dam` commands: the subcommand list and menu in `packages/api-server/src/modules/channels/infrastructure/slack-command-menu.ts`, the dispatch in `slack.ts` (beside `unignore`), and the usage help, with the forms `approvals`, `approvals off` and `approvals on`.
   It works in any conversation, and its answer is always ephemeral, for the caller alone.
   Take the command's name from the brand config, as the other commands do.
2. **Caller.** Resolve the caller with `identityLinks.resolve("slack", userId)` in the command's team.
   No link → a private answer that the login command links the account.
   The list covers the agents the caller owns; an editor's agents are not listed.
3. **The set.** Add `ownerRequests.listWaiting(ownerSub)`: the owner's pending approvals of every type (the approvals service path behind `approvals.listForOwner`) and the questions that wait for the owner (the `ownerQuestions` set `attention-service.ts` reads), newest first.
   Group network approvals of one agent and host as the background card's host rows do.
4. **Render.** Build one ephemeral message:
   - a header with the count, or "Nothing waits for you.";
   - per request, the renderer of its type from [03](./03-mcp-tool-call-cards.md), [04](./04-network-and-web-search-cards.md) and [07](./07-subagent-questions.md) in a compact form (details cut shorter), with block ids that name the request, so the fields of one question are read apart from another's;
   - per request of any other type (an agent's own rule proposals, spend-limit questions, a harness prompt until [09](./09-harness-prompts-on-slack-turns.md), a verdict only the app offers): a one-line summary and "Open in app";
   - stop before Slack's limit of 50 blocks and end with "…and <n> more in the app" and a link to the approvals list in the app.
5. **Click.** The `owner-request:` route of [03](./03-mcp-tool-call-cards.md) already applies the choice; when the click comes from the list (an ephemeral message), it also re-renders the list for the caller and replaces it in place (the `replace` callback), and the settle edits any DM card of that request through [05](./05-card-lifecycle.md).
   Check that `handleMessageAction` gets the message `ts` of an ephemeral post (`container.message_ts`).
   An ephemeral message changes only through a `response_url`, and Slack lets one `response_url` be used five times within 30 minutes.
   Each click carries its own `response_url`, and the refresh uses that one; check on the local cluster that six clicks in a row on one list still refresh it, and post a new private list when a refresh fails.
6. **Turn cards off and on.** Store the caller's choice per owner in the channels module (a column on a channels-owned per-owner table, with a migration).
   `canCard` of [01](./01-one-hold-decision.md) reads it and returns `muted`, so a muted owner is treated like an unlinked one: a new Slack-turn request is refused at once, and no new card goes out.
   - `approvals off`: store it; keep each card that still has a waiting request until the request settles, so a held turn keeps its card; close every other open card of the caller with "You turned cards off"; answer privately how to turn them back on;
   - `approvals on`: clear it, and answer privately that cards are on;
   - `approvals` lists as before, muted or not.
     For `muted`, the turn contract of [01](./01-one-hold-decision.md) says that the owner does not take requests in Slack.
7. **Docs.** In `docs/architecture/slack-commands.md`, add `/dam approvals`, `off` and `on`.
   In `docs/architecture/channels.md`, the count of commands the usage help lists.
   In `docs/architecture/slack-guarantees.md`, the command table.
   In `docs/architecture/slack-owner-requests.md`, the list (its set, its renderers, the fallback and the block limit) and the mute.
   In `.quality-inspector/qi-profile-dam/SKILL.md`, the command and its forms.

## Acceptance criteria

- [ ] `/dam approvals` by a linked owner lists, privately, every request the web bell shows for them: carded and uncarded approvals, and sub-agent questions.
- [ ] Network, web-search, MCP tool-call, launch-rule and question entries carry their buttons or form; other types show a summary and "Open in app".
- [ ] Acting on an entry settles the request, refreshes the list in place, and edits its DM cards.
- [ ] With more requests than fit, the list ends with "…and <n> more in the app".
- [ ] An unlinked caller gets the link hint; a caller with nothing waiting gets "Nothing waits for you."
- [ ] An editor sees only their own agents' requests.
- [ ] Six clicks in a row on one list refresh it each time.
- [ ] After `/dam approvals off`, the owner's cards with nothing waiting close, a turn card whose request still waits stays until it settles, no new card goes out, and a new Slack-turn request is refused at once; the list still works.
- [ ] After `/dam approvals on`, cards go out again.
- [ ] `mise run check` and `mise run //packages/api-server:test` pass.

## Smoke test

Set up as in [01](./01-one-hold-decision.md).

1. In the web, ask the agent to fetch `https://example.org/` and keep using the web UI, so it gets no card; in Slack, ask a second agent to fetch `https://example.net/` from another member.
2. As the owner, run `/dam approvals` in any channel: both requests are listed, only for the owner.
3. Click Allow once on the first entry: the list refreshes without it, and the web's approvals list no longer shows it.
4. Run `/dam approvals off`; ask the second agent for a new host: refused at once, and the agent says its owner does not take requests in Slack.
   Run `/dam approvals on`; ask again: a turn card arrives.
5. Run `/dam approvals` as the other member (linked): their own list, without the owner's requests.
6. `/dam logout`, run `/dam approvals`: the link hint.
