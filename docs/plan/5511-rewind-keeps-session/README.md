# A rewind keeps the session

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/5511

## Goal

Today a rewind and a take-back copy the conversation into a new Session and delete the original.
The new id hides the cost and the telemetry of every message before the cut, changes the chat's URL, and makes a take-back of a long chat slow.

After this change, on a Claude Code agent:

- **Take-back** (Escape in an empty input, on a message the agent has not answered) and **edit-and-rewind** ("Rewind to this message") cut the conversation in place.
  The Session keeps its id, so per-message cost, the session's total, its telemetry and its URL stay.
- Every other open tab of the chat reloads it on the same URL.
- **Fork** from a message does not change: it still makes a new conversation.
- Harnesses that declare no cut (Codex, Pi, Bob) keep today's fork.

## Approach

Pages: [sessions](../../architecture/sessions.md) (Session log, history provider, rewinding and forking, take-back) and ADR-026 (the per-session log).

**The harness's own store can be cut in place.**
The Claude Agent SDK that the image bundles with the ACP adapter (`@anthropic-ai/claude-agent-sdk` 0.3.293, in `/usr/local/lib/harness/claude-code/adapter/claude-agent-sdk.js`) can resume a session at an earlier chain entry (`resumeSessionAt`).
The transcript keeps the cut part as a dead branch and goes on from the cut, under the same id.
A feasibility study on 2026-10-20, against that SDK, showed:

- A resume at the entry before a user message, followed by an empty `shouldQuery: false` user message, persists the cut at once, with no model call (0 turns, 0 new tokens).
  Without the empty message the cut is not saved.
- `resumeDropsTurn: <uuid of the dropped user message>` refuses the cut (`Resume rejected by --resume-drops-turn: …`) when anything else would be dropped, and changes nothing.
- A stopped turn (partial reply plus the harness's interrupt note) is dropped whole.
- The next plain resume, and `getSessionMessages`, see the cut history.

**The cut goes through a provider the image declares, not through the adapter.**
The adapter keeps each session's creation `_meta` and replays it when it rebuilds a query (provider change, sign-out), so a cut passed through `_meta.claudeCode.options` would run again and drop newer messages.
ACP also has no way to send the empty `shouldQuery: false` message.
So, like the existing **session-history provider** (`sessionHistory` in the runtime manifest, served by `harness-history-lib.mjs` in a worker thread), an image may declare a **session-cut provider** (`sessionCut`): a module in the image that cuts the harness's stored conversation of an idle, closed Session.
The runtime cuts in place when the Session's harness declares one; otherwise it forks, as today.

**The runtime resets the Session instead of adopting a copy.**
The runtime's per-session log only grows (ADR-026).
After a cut it **resets** the Session: it closes the harness's live copy first, cuts, drops its log, fills it again from the history provider, and tells the viewers engaged before the reset that the Session was reset.
Metadata, the id and everything the api-server keys by it (spend, telemetry, attention, session directory) stay.
The next prompt rehydrates the harness from the cut store, as after a restart.

**Decisions (grill session, 2026-10-20):**

1. Viewers learn about the cut through one ephemeral **session reset** notification and reload the chat; there is no cut position in the log.
2. The set of Sessions that may be rewound does not change (`rewriteRefusal` stays as it is).
3. A cut that fails unexpectedly refuses with a visible error; there is no fallback to the fork.
   A refusal by the cut's guard ("the agent already answered") stays silent, as today.
4. When the cut is before the first message (`{kind: "start"}`), today's paths stay: take-back deletes the Session into a new-chat draft; edit-and-rewind starts a fresh Session.
5. The architecture diagram made for this discussion is not kept up to date; `sessions.md` is the record.

**Contracts (pinned).**

Runtime manifest (`packages/agent-runtime/src/modules/runtime-channel/manifest.ts`), beside `sessionHistory`:

```yaml
sessionCut:
  module: "/usr/local/lib/harness-cut-lib.mjs"
  exportName: "cutSession"
```

`module` is required; `exportName` defaults to `cutSession`.

The provider's export:

```ts
cutSession(input: {
  sessionId: string;
  before: string;      // uuid of the first user entry of the batch to drop; the cut keeps everything before it
  dropsTurn?: string;  // take-back only: same uuid, arms the SDK guard
}): Promise<{ ok: true } | { ok: false; refused: boolean; message: string }>
```

`refused: true` means the guard refused and nothing changed.
The runtime gets `before` from the user frames of its own log: their `_meta.platform.entry` and `update.messageId` are the user entry's uuid.

New platform notification (`packages/api-server-api/src/modules/acp/types.ts`):

```ts
// method "platform/sessionReset", params:
{
  sessionId: string;
}
```

It is ephemeral, like `platform/queueChanged`: sent to the viewers engaged before the reset, never logged.

## Sub-issues

| #     | Title                                            | Scope                                                                                           | Depends on |
| ----- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------- |
| 01    | ADR: a Session can be reset in place             | ADR amending ADR-026; `sessions.md`; glossary                                                   | —          |
| 02 ✅ | The Claude Code image cuts a session in place    | `harness-cut-lib.mjs`, its manifest declaration, the `sessionCut` schema, a generic worker call | —          |
| 03    | The runtime cuts in place and resets the Session | `rewriteFrom` in-place path, the reset, `platform/sessionReset`                                 | 01, 02     |
| 04    | The chat reloads on a reset                      | UI handles `platform/sessionReset`; the asking tab skips its own reload                         | 03         |

## Conventions & glossary

- **Take-back**: Escape on an unanswered newest message; the message goes away and its text returns to the input.
- **Rewind**: edit an earlier message and continue the conversation from it, dropping what came after.
- **Fork**: edit an earlier message into a new conversation; the original stays.
- **Cut in place**: the harness's stored conversation goes on from an earlier entry under the same id.
- **Session reset**: the runtime drops a Session's log and fills it again from history, keeping its id and metadata; viewers reload.
- **Session-cut provider**: the image-declared module that cuts in place.

Apply `/typescript-engineering` to agent-runtime and api-server-api code, `/react-ui-engineering` to `packages/ui`.
Do not author new tests unless a sub-issue says so; verify with the existing suites and the smoke tests.

## Whole-feature smoke test

On the local cluster (`cluster-ops` skill), with the agent image and agent-runtime rebuilt from this branch, a Claude Code agent with telemetry on:

1. Open a chat, have three short turns, and note the URL, each reply's cost and the session's total in the list.
2. Open the same chat in a second tab.
3. In tab 1, send a fourth prompt and press Escape at once with the input empty.
   The prompt returns to the input; the URL does not change; the three replies keep their costs; the total in the list does not drop.
   Tab 2 reloads and shows three turns.
4. Send "List what I asked you so far." — the reply does not mention the taken-back prompt.
5. Rewind to the second message with an edited text.
   The URL does not change; the first reply keeps its cost; tab 2 reloads and shows the edited conversation.
6. Restart the agent pod and open the chat: the history shows the cut conversation, not the dropped turns.
7. Fork from a message: a new conversation appears in the list, and the original is unchanged.
8. On a Codex agent, rewind still works through the fork (new id).

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/5511.
