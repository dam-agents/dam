# 02 — The agent can link an earlier message

**Depends on:** 01-every-turn-offers-its-own-thread
**Part of:** A Slack agent can read and link the thread it is answering in — see [README](./README.md)

## Context

A Slack link to a message needs the conversation id and the message `ts`, and the agent has neither the `ts` of an earlier message nor the workspace address.
This slice puts the `ts` on each `read_thread` line and adds an MCP tool, `get_message_link`, that returns the Slack link of one message.
With slice 01, the agent can then read its thread, find the message, and give its link — the request that failed in the thread that filed #6147.

## Implementation plan

Apply the `/typescript-engineering` skill (code mode).

1. **`ts` on `read_thread` lines.**
   `labelHistoryMessage` in `packages/api-server/src/modules/channels/infrastructure/agent-footer.ts` writes `[<time>]` after the label.
   Give it an option (next to `showThreadMarkers`) that writes `[<time>, ts <ts>]` instead.
   Thread the option through `labelMessages` in `slack.ts`.
   Only the `readThread` call (`labelMessages(…, { showThreadMarkers: false })` in `readThread`) turns it on; injected history, catch-up and the owned-thread frame stay as they are.
   Use the same `ts <value>` form that the `[thread: …]` marker already uses.
2. **Contract.**
   In `packages/api-server/src/modules/channels/services/worker-contract.ts`, next to `ReactionsQuery` and `messageReactionsResultSchema`, add a query (`conversationId?`, `messageTs`) and a result schema (`link`, `conversationId`, `messageTs`).
   Add the method to `AddressedWorker` next to `describeMessageReactions`.
3. **Channel manager and its RPC.**
   In `packages/api-server/src/modules/channels/services/channel-manager.ts`, add the method everywhere `describeMessageReactions` appears: the `ChannelManager` interface, `ADDRESSED_METHODS`, the argument schemas, the result schemas, and the "not supported on <channel>" fallback (Telegram has no implementation).
   A non-leader replica reaches the leader through this RPC, so a missing entry breaks the tool on every non-leader.
4. **Slack worker.**
   In `slack.ts`, implement the method next to `describeMessageReactions`, and copy its gate:
   resolve the target with `resolveOutboundTarget` from `query.conversationId`, else the conversation of a turn whose message has that `ts` (`findTurnRef`), else the one conversation the agent's live turns run in, with the same `refuseOutsideOwnerReach` check.
   Decided during implementation: a `ts` from `read_thread` is usually an earlier reply, not a turn's message, so without the last fallback an agent bound to several conversations would always need `chatId`.
   Call `gw.getPermalink(target.id, messageTs, target.teamId)`.
   A `null` link is an error that tells the agent to check `messageTs` and `chatId`.
   A thrown error goes through `formatError`, as in the other read methods.
   The worker already calls `getPermalink` for every turn, so the install has what the call needs; confirm on the dev cluster.
5. **MCP tool.**
   In `packages/api-server/src/apps/harness-api-server/mcp-endpoint.ts`, add `get_message_link` next to `describe_message_reactions`, with the same parameter style: `channel`, `chatId` (optional: an id from `describe_channel` or the `conversationId` that `read_thread` returns; omit for the conversation you are answering in), `messageTs` (required: the `ts` on a `read_thread` line, or a `ts` a tool result named).
   Its description says what it is for (a link to one message, for an issue, a document or a reply), what it returns (`{ link, conversationId, messageTs }`), and "Slack only".
   Log it with `securityLog` as `channel.message_link`, success and failure, with the conversation and `ts`, never message content.
6. **`read_thread` description.**
   Say that each line carries its message's `ts`, which `get_message_link` and `describe_message_reactions` accept.
7. **Existing tests.**
   Update expectations that pin `read_thread` lines (for example the `messages` array in `packages/api-server/src/__tests__/unit/slack-thread-visibility.test.ts`) and any test that lists the channel manager's methods or the MCP tools.
   Do not add tests.
8. **Docs** (one sentence per line, simple words):
   - `docs/architecture/channel-turns.md`:
     the `read_thread` bullet says each line carries its message's `ts`.
     Rewrite its sentence "a labelled line carries a readable time, never the id a read takes": a line now carries its message's `ts`, which links or inspects that message, and the cursor is still the only way to read further back.
     Add a bullet for `get_message_link` in "What the agent sees", next to `describe_message_reactions`: what it returns, its reach, Slack only.
   - `docs/architecture/slack-guarantees.md`:
     the list "Nine work from any session" adds `get_message_link` and becomes ten;
     the capabilities row that lists `read_thread` and `fetch_message_attachment` adds `get_message_link`.
   - Update `Last verified:` on each page you change.

## Acceptance criteria

- [ ] Each `read_thread` line shows its message `ts` as `[<time>, ts <ts>]`; injected history and catch-up lines are unchanged.
- [ ] `get_message_link` with a `ts` from a `read_thread` line returns a link that opens that message in Slack, including a reply inside a thread.
- [ ] `get_message_link` without `chatId` resolves the conversation of the message being answered.
- [ ] `get_message_link` for a conversation outside the agent's reach is refused like `describe_message_reactions`.
- [ ] On Telegram, the tool returns "not supported".
- [ ] The tool works from a non-leader replica (its RPC entries are complete).
- [ ] `channel.message_link` is logged on success and failure, without message content.
- [ ] `channel-turns.md` and `slack-guarantees.md` describe the `ts` on `read_thread` lines and the new tool.
- [ ] `mise run //packages/api-server:test`, `mise run check` and `mise run check:comment-types` pass.

## Smoke test

1. Run `mise run //packages/api-server:test` and `mise run check`.
2. On the local dev cluster with Slack wired (`cluster-ops` skill), install the branch's api-server.
3. In a thread with an agent, where the first reply has a small file, restart the api-server (as in slice 01), then tag the agent: "Give me the Slack link to the reply with the file."
4. Expect a link in its answer that opens that reply in Slack.
   `mise run cluster:kubectl -- logs deploy/platform-apiserver --since=10m | grep -E 'channel\.(thread_read|message_link)'` shows a success line for each.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
