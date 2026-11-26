# 03 — MCP tool-call rows and cards

**Depends on:** 02-card-base
**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Context

After [02](./02-card-base.md), every routed request reaches the owner's DM, but the only button is "Open in app".
This slice adds the first answers in Slack: the MCP tool-call row of the turn card and the call card, with their buttons, the click route that applies a choice as the owner, and the audit of a Slack answer.
It comes first because it serves the one need with a named stakeholder: a person approves each email an agent sends through an Outlook Connection.
It is also the one hold where an answer always counts today: #6421 sets the MCP tool timeout to the hold window, and an approve once outlives the client, so a call that waited too long passes on the next try.
The gateway still ends a held call after 5 minutes until #6855 is fixed.
MCP tool-call approval is behind the experimental `mcp-tool-approval` feature, so these cards appear only where it is on.
A background tool call always gets a card of its own, so an email never waits behind blocked hosts.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Request view.** Extend `ownerRequests.view` with the `mcp_tool_call` kind: the Connection's name, the tool, the target label of #6421 (`tool-call-labels.ts`), the arguments, and the expiry.
2. **Renderers.** In `packages/api-server/src/modules/channels/domain/`, add:
   - the **MCP row** of the turn card and the **call card**: "<Agent> wants to call <tool> on <Connection>", the target label, the arguments in a code block cut at about 2,500 characters with "Open in app" when cut, the expiry, and Approve once (`primary`) and Deny once (`danger`), mapped in `decide` to #6421's verdicts.
     "Allow all once" and "Deny all" ([04](./04-network-and-web-search-cards.md)) never cover an MCP row.
3. **Click.** In `slack.ts` `handleMessageAction`, route an `owner-request:` action before the agent actions (`agentActionOf`):
   - resolve the clicker with `identityLinks.resolve("slack", userId)` in the click's team; when it is not the request's owner, answer privately "Only <owner> can answer this" and change nothing;
   - apply the choice through a new `ownerRequests.decide` port, run as the owner;
   - a request that is already settled answers privately "Already answered" (the service's compare-and-set decides);
   - on success, edit the row or the card to its outcome line (the `replace` callback passed to `onMessageAction`).
   - a `confirm` object on a button (used by [04](./04-network-and-web-search-cards.md)) is Slack's own dialog, so the click arrives only after the owner confirmed.
     A click never posts a message, so a DM bound to an agent through the DM Bridge starts no turn from it.
4. **Audit.** The verdict's `decidedBy` is the owner; the security log line of the decision names the Slack user id and team with basis `slack`.
5. **Docs.** In `docs/architecture/slack-owner-requests.md`, add: who may answer, the owner check on a click, the MCP row and the call card.
   In `docs/architecture/agent-editors.md`, one sentence: in Slack only the owner answers; editors answer in the web.
   In `docs/architecture/connections.md`, one sentence that a held tool call can reach the owner in Slack, linking the page.
   In `.quality-inspector/qi-profile-dam/SKILL.md`: a held MCP tool call reaches a linked owner as a row or a card with Approve once and Deny once.

## Acceptance criteria

- [ ] With `mcp-tool-approval` on, a tool on "needs approval" and a linked owner, a Slack-turn tool call is a row of the agent's turn card with the tool, the Connection, the target and the arguments.
- [ ] A schedule fire's tool call gives a call card with the same content.
- [ ] Approve once runs that one call; Deny once refuses it; the row or card shows the outcome.
- [ ] An argument that holds `<https://example.org|Open in app>` shows as plain text, not as a link.
- [ ] A click by a Slack user whose link is not the owner changes nothing and gets a private refusal; a click on a settled request answers "Already answered".
- [ ] The approval row records the owner as `decidedBy`, and the security log names the Slack user with basis `slack`.
- [ ] `mise run check` and `mise run //packages/api-server:test` pass.

## Smoke test

Set up as in [01](./01-one-hold-decision.md), with `mcp-tool-approval` on for the owner.

1. Set a test MCP Connection (or the Slack Account) to "needs approval" and grant it to the agent bound to the test channel.
2. From another member, ask the agent to call one of its tools: the owner's turn card shows a row with the tool, the Connection and the arguments.
3. Approve once: the agent shows the tool's answer in the thread; the row shows "Allowed once by you".
4. Run a schedule that calls the tool with no browser open: a call card arrives; Deny once: the agent says the call was refused.
