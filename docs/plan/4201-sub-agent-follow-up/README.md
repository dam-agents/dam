# A finished sub-agent cannot be asked follow-up questions

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4201

## Goal

From a finished sub-agent's read-only conversation, the user clicks **Continue in new chat** and lands in a new chat of the root driver.
The chat already shows the sub-agent's prompt and result as two bubbles, then a divider "Continued from <label>".
The user asks follow-up questions in the normal composer, and the agent answers with the sub-agent's work in context.
Every later load of that chat shows the same two bubbles and the divider, then the real conversation, as if it all happened in this chat.

## Approach

Read [`docs/architecture/invocations.md`](../../architecture/invocations.md) (the delegation record) and [`docs/architecture/sessions.md`](../../architecture/sessions.md) (load, history providers, rewind and fork) first.

- **The copy is the record, not the transcript.** A sub-agent does one turn, so its prompt and its result (`DelegationNode.prompt`, `DelegationNode.result`, both in Postgres) are the whole conversation the user cares about.
  The stored transcript file is not read.
- **The root driver gets the chat.** The read-only panel already knows the root driver (`DockedDelegationPanel`'s `driverAgentId`).
  A grandchild's immediate driver is a released sub-agent, so it is never the target.
- **The chat is a normal Session.** It is created at the first send, like any new chat.
  Before that it is a new-chat draft that carries the copy.
- **The copy lives in its own runtime document.** The UI sends it on `session/new` as `_meta.platform.continuedFrom`.
  The runtime stores it in a `continued-from` document on the agent's disk, keyed by session and byte-capped, beside the undelivered-prompts document.
  It stays out of session metadata, which is rewritten on every metadata change.
  It survives a log eviction and a cold reload from a session-history provider, and goes with its Session.
- **The agent gets the whole result.** A big result is not cut or summarised by the platform: the harness manages its own context and compacts when it needs to.
  The bubble folds a long result behind "Show all".
- **The agent gets the copy once, hidden.** The runtime prepends a `<continued-from>` block to the first prompt it forwards to the harness.
  The echo and the title use the typed text only.
  The UI strips the block like the other plumbing tags, so a history-provider refill never shows it in the first bubble.
- **Every load returns the copy.** `session/load` (and the provider-served path) returns `continuedFrom` in the load response's `_meta`, like `runStarts`.
  The UI draws the two bubbles and the divider from it, above the replayed tail.
- **Rewind and fork keep working.** The rewind lookup compares texts with the `<continued-from>` block removed, and a rewritten first message carries the copy again.

### Contract: `continuedFrom`

The same shape travels on `session/new` (`_meta.platform.continuedFrom`) and back on every load (`_meta.platform.continuedFrom` on the load response):

```ts
interface ContinuedFrom {
  invocationId: string;
  label: string;   // sub-agent label, or the first line of its prompt
  prompt: string;  // the sub-agent's prompt, as recorded
  result: string;  // the sub-agent's result as text (a non-string result is JSON-stringified)
}
```

`prompt` and `result` are at most 1 MiB each; `label` at most 200 characters.
The runtime refuses a larger value on `session/new`.

The harness receives it once, before the first typed text:

```text
<continued-from label="...">
<prompt>...</prompt>
<result>...</result>
</continued-from>

<typed text>
```

The exact block wording belongs to slice 01; the tag name `continued-from` is fixed, since the UI strips it.

## Sub-issues

| #   | Title                                          | Scope                                                                       | Depends on |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------- | ---------- |
| 01  | ✅ The runtime keeps a follow-up chat's copy   | agent-runtime: accept, store, inject once, return on load, rewind match     | —          |
| 02  | Continue in new chat from a finished sub-agent | UI: panel button, seeded draft, send, load rendering, divider, plumbing tag | 01         |

## Conventions & glossary

- **Sub-agent**: the concept; **invocation** stays the record and module name (`invocations`).
  The user sees "sub-agent".
- **Root driver**: the agent whose chat started the delegation tree; it owns the follow-up chat.
- **Follow-up chat**: a normal Session whose metadata holds `continuedFrom`.
- **Copy**: the sub-agent's prompt and result shown as the first two bubbles.
- Apply `/typescript-engineering` in slice 01 and `/react-ui-engineering` in slice 02.
- Update `docs/architecture/sessions.md` (follow-up chats, load meta, rewind match) and `docs/architecture/invocations.md` (the panel action) in the slice that changes the behaviour, per `docs/guidelines/documentation-guidelines.md`.

## Whole-feature smoke test

1. On the local cluster, ask an agent to spawn one sub-agent with a short task and wait for its result.
2. Open the finished sub-agent from its delegation card.
   The panel footer shows **Continue in new chat**.
3. Click it.
   A new chat of the root driver opens with the prompt bubble, the result bubble and the divider "Continued from <label>".
   No session appears in the sidebar yet.
4. Ask "Why did you choose that?".
   The reply refers to the sub-agent's work.
   The user bubble shows only the typed question.
5. Reload the page and reopen the chat: the two bubbles, the divider and the conversation show in order.
6. Restart the agent pod (`mise run cluster:kubectl -- -n platform-agents delete pod <agent>-0`) and reopen the chat: the same view, and no `<continued-from>` text in the first bubble.
7. Fork from the first user message: the fork keeps the two bubbles and the divider.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/4201.
