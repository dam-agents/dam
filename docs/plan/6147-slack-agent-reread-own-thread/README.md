# A Slack agent can read and link the thread it is answering in

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/6147

## Goal

Slack threads about a design or a decision run for days.
People ask an agent in such a thread to act on an earlier reply, for example "link the message with the HTML attachment in the issue".
Today the agent cannot do that.
It cannot read the thread it is answering in, and it cannot make a link to an earlier message.
It asks a person to paste the link, as happened in the thread that filed this issue.

After this change:

- An agent can always read the thread it is answering in with `read_thread`, however old the thread is.
- The agent can get the Slack link of any message that it read, and put it in an issue, a document or a reply.

Attachments already work: every line of history, catch-up and `read_thread` names its files with a `fileId`, and `fetch_message_attachment` has no time limit.
When the thread is readable, its files are reachable.

## Approach

Read [channel-turns](../../architecture/channel-turns.md) (sections "Injected history says what it is" and "Outbound — agent to channel"), [slack-guarantees](../../architecture/slack-guarantees.md) and [slack-threads](../../architecture/slack-threads.md) first.

### Why the agent cannot read its own thread

`read_thread` reads only a thread in the **offer map**: an in-memory map in the channel leader, from (agent, thread `ts`) to the conversation, with a 48 h TTL (`offeredThreads` in `packages/api-server/src/modules/channels/infrastructure/slack.ts`).
Since #6292, a thread the session owns is readable too (`ownedThreads.findForAgent` in `readThread`).
The offer map gets entries in two places:

- `buildThreadPrompt` (a fresh session) offers the `[thread: …]` markers of a channel window, and offers the turn's own thread **only when the injected thread history was cut short** (`threadWindow.cursor !== null`).
- `buildCatchUp` (a resumed session) offers only the `[thread: …]` markers in its catch-up block, **never the turn's own thread**.

So a short thread is never offered to the agent that answers in it, and a resumed turn never renews the offer.
A thread is otherwise readable only by chance, when its opening message appears as a `[thread: …]` line in a channel window.
The agent in the reported case said its thread was offered that way on the day the thread started, and the offer had expired 48 h later.

The design assumed that a session already holds its own thread ("A thread the Agent is not inside is read with `read_thread`").
Three facts break that assumption:

1. Catch-up can be capped: the agent is told "Some messages from this gap were left out", and has no way to read them.
2. Harnesses compact long sessions, so old turns leave the context.
3. An agent can stay in one thread for days.

### The fix: every turn offers its own thread

Each turn in a thread writes that thread to the offer map, fresh or resumed, addressed or read-along.
The 48 h count from the newest turn there.
This keeps the documented read rule — the agent reads only what the platform showed it — because the platform has just handed the agent this thread as its turn.
It does not change the offer map, its TTL or where it lives.

### The fix for links

A Slack link to a message (a permalink) needs the conversation id and the message `ts`.
Today a line shows the author, the time to the minute, the text and the files, but not the `ts`.
No tool gives the workspace address or a link.

- `read_thread` lines also carry their message's `ts`.
  Injected history and catch-up lines stay as they are, so a turn's prompt does not grow.
- A new MCP tool, `get_message_link`, returns the Slack link of one message, from Slack's `chat.getPermalink`.
  Its reach is the same as `describe_message_reactions`: a message in a conversation the agent can reach.

### Decisions taken while planning

- Option A (every turn offers its own thread) was chosen over a durable Postgres record of turns and over a binding gate (any thread in a bound conversation).
  The Postgres record costs a migration and a write per turn, and gains only the case of a deploy during a turn.
  The binding gate changes the documented read rule, so it needs an ADR and its own issue.
- Links are in scope: #6147 names them in its Problem, its Expected Behavior and step 3 of its reproduction, and read access alone would not have solved the reported request.
- Only `read_thread` lines carry the `ts`; a turn's history and catch-up do not.

### Known limits (stated, not fixed)

- Offers live in the channel leader's memory.
  A deploy or a leader change during a turn clears the offer until the next turn in that thread.
  The catch-up boundary has the same limit today.
- A turn that runs longer than 48 h loses its offer.
- A whisper thread in a DM that is not bound to the agent stays unreadable: `readThread` still requires a bound conversation.
- A thread that a person links in a message, but the agent was never shown, stays unreadable.

## Sub-issues

| #     | Title                                                                              | Scope                                                                                                                                                                 | Depends on |
| ----- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| ✅ 01 | [Every turn offers its own thread](./01-every-turn-offers-its-own-thread.md)       | Offer the turn's thread in `buildThreadPrompt` and `buildCatchUp`; new refusal copy and `read_thread` description; a capped thread catch-up names `read_thread`; docs | —          |
| ✅ 02 | [The agent can link an earlier message](./02-agent-can-link-an-earlier-message.md) | `ts` on `read_thread` lines; new `get_message_link` tool through the MCP endpoint, channel manager RPC, worker contract and Slack worker; docs                        | 01         |

## Conventions & glossary

- **Offer**: an entry in the offer map that lets `read_thread` read one thread for one agent, and tells it which conversation the thread is in.
- **The turn's own thread**: the thread a turn runs in (`ctx.threadTs` when `ctx.hasThread`).
  A top-level message has no thread yet; its first reply starts one, and the next turn there offers it.
- **Message `ts`**: Slack's id of a message inside its conversation, for example `1793312934.604549`.
- **Permalink**: Slack's link to one message, from `chat.getPermalink`.
- Apply the `/typescript-engineering` skill (code mode) to every change.
  All changes sit in the channels module and the harness API server; there is no UI change.
- Follow [comment-guidelines](../../guidelines/comment-guidelines.md) and run `mise run check:comment-types`.
- Follow [documentation-guidelines](../../guidelines/documentation-guidelines.md): one sentence per line, and a behavior change updates `slack-guarantees.md` in the same commit.
- Agent-facing copy (tool descriptions, refusals, legends) is plain and short, and never promises what the platform does not do.
- No new tests.
  Existing tests whose expected output changes are updated, not removed.

## Whole-feature smoke test

On the local dev cluster with the Slack workspace wired (use the `cluster-ops` skill to install the branch's api-server):

1. Post a top-level message in a channel bound to an agent.
   In its thread, post two replies; attach a small file to the first one.
2. Tag the agent in that thread with a short request, and wait for its answer.
3. Restart the api-server, which clears every offer as 48 h would:
   `mise run cluster:kubectl -- rollout restart deploy/platform-apiserver`, then `mise run cluster:kubectl -- rollout status deploy/platform-apiserver`.
4. Tag the agent in the same thread: "Read this thread, give me the Slack link to the reply with the file, and tell me what the file contains."
5. Expect: the agent posts a link that opens that reply in Slack, and it describes the file.
   `mise run cluster:kubectl -- logs deploy/platform-apiserver --since=10m | grep -E 'channel\.(thread_read|message_link|attachment_fetch)'` shows `"result":"success"` for each.

On `main`, step 5 fails: `channel.thread_read` logs "not a thread you were shown", and the agent asks for the link.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/6147.
