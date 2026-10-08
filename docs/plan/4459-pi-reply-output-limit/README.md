# Pi agents keep a reply that hits the output limit

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4459

## Goal

A Pi agent on the IBM LiteLLM provider stops a long reply at 8192 output tokens. Pi then removes
that reply from its own conversation. The user still sees the reply, but the agent no longer knows
it wrote it, so "continue" or "fix section 5" fails. After an agent restart the reply is also gone
from the reopened chat. The chat never says that the reply was cut, so it looks complete. Every Pi
reply reports 0 tokens.

After this change:

- A reply that stops at the output limit stays in the agent's conversation, so the agent can
  continue it, and it stays in the chat after a restart.
- The chat shows a muted line under such a reply: "Reply stopped at the output limit." The line
  is still there after a reload, in other tabs, and after the chat is reopened or the agent
  restarts.
- Pi replies report their real token counts.
- On IBM LiteLLM, Pi replies can be four times longer (32768 output tokens instead of 8192), so a
  cut becomes rare.
- Pi can use `azure/gpt-6-astra` on IBM LiteLLM. Today every prompt to it fails.

## Approach

### Why Pi drops the reply

- [`pi-dynamic-providers`](../../../packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/extensions/pi-dynamic-providers/index.ts)
  registers the `openai-proxy` provider with `compat.supportsUsageInStreaming: false`. Pi then
  does not send `stream_options.include_usage`, so every reply has `usage.output = 0`.
- Pi (`pi-coding-agent` 1.0.4, `AgentSession._checkCompaction`) calls pi-ai's
  `isRecoverableLength(message, model.maxTokens)`: a `length` stop whose `usage.output` is below
  the model's `maxTokens` reads as a full context. Pi then omits the reply with a `context_edit`
  (`replacement: null`) and runs overflow compaction.
- With real counts the output equals `maxTokens` (8192 = `OPENAI_PROXY_MAX_TOKENS` from the IBM
  LiteLLM connection), so the check is false and Pi keeps the reply. A `length` stop below
  `maxTokens` still happens when Pi clamps the request to fit a full context; that is a real
  overflow, and Pi's recovery is right there.
- `gcp/gemini-3.1-pro-preview` reports 4 tokens below the request's cap on every cut (probed at
  64 to 4096), so the extension reports a `length` stop's output as the request's cap. A request
  that Pi clamped has a lower cap, so Pi's own recovery still sees it.
- pi-acp rebuilds a reopened chat from Pi's projected messages (`get_messages`), so an omitted
  reply is also missing after a restart. Keeping the reply fixes both.

### Why the chat says nothing

- pi-acp 0.0.34 (the newest release) ends every turn with `end_turn` or `cancelled`
  (`PiAcpSession.settleTurn`). It never reports ACP `max_tokens`. The Claude Code adapter
  (`claude-agent-acp` 0.86.0) does.
- The agent-runtime already copies the prompt response's `stopReason` into the logged
  `platform/turnEnded` notification
  ([`acp-runtime.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts)).
  The UI ignores it.
- `platform/turnEnded` lives only in the runtime's in-memory session log. The runtime drops that
  log 3 s after the last viewer leaves a chat (`idleReapDelayMs` in
  [`compose.ts`](../../../packages/agent-runtime/src/modules/acp/compose.ts)), and a pod restart
  loses it too. A reopened Pi chat is rebuilt by pi-acp's `session/load` replay, which carries no
  stop reason. Pi has no session-history provider.

### The fix, in three parts

1. **Pi image (01).** The `openai-proxy` provider asks for streamed token counts, and a `length`
   stop reports the request's cap as its output. The in-memory pi-acp patch answers a turn whose
   last reply stopped at `length` with ACP `max_tokens`, and stamps
   `_meta.platform.stopReason: "max_tokens"` on the replayed text of such a reply.
2. **Contract and UI (02).** `platformFrameMetaSchema` gains `stopReason`. The UI marks a reply
   as cut from either source: `platform/turnEnded.stopReason` while the log is live, or the frame
   stamp after a reopen. Main already stamps a reply's `model` this way (`stampActiveReplyModel`),
   so this follows the same path.
3. **Output limit (03).** The IBM LiteLLM connection raises `OPENAI_PROXY_MAX_TOKENS` from 8192
   to 32768, with a data migration for existing connections, and the `openai-proxy` provider sends
   `max_completion_tokens` instead of `max_tokens`.

The stamp follows an existing pattern: replayed `session/update` frames already carry per-reply
platform metadata (`at`, `telemetryPromptId`, `model`), and the runtime merges into
`_meta.platform` without dropping what the harness sent
([`session-transcript.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime/session-transcript.ts)).
No runtime change and no new storage.

Architecture pages this touches: [agent-lifecycle](../../architecture/agent-lifecycle.md)
(session log, replay metadata, end-of-turn signal) and
[connections](../../architecture/connections.md) (stored contributions, `env` on the runtime
channel rail; an `env` change recycles the harness at an idle turn boundary). Neither changes:
agent-lifecycle already says that a replayed entry carries only what its source supplied, and it
sits at its character cap.

### Evidence from the IBM LiteLLM proxy (probed 2026-10-08)

Every chat model on the proxy, one tiny prompt per call:

| Request | Result |
|---|---|
| `max_tokens` 32000 / 64000 | 200 for every working chat model except `azure/gpt-6-astra` |
| `max_tokens` 128000 | 400 for `aws/claude-opus-4-5` (limit 64000) and `gcp/gemini-3.1-pro-preview` |
| `max_tokens`, any value, `azure/gpt-6-astra` | 400: "Unsupported parameter: 'max_tokens' … Use 'max_completion_tokens' instead" |
| `max_completion_tokens` 32768, every chat model | 200, `gpt-6-astra` included |
| `stream` + `stream_options.include_usage`, every chat model | 200, final chunk carries `usage.completion_tokens` |
| `/v1/model/info`, `/model/info` | 403: the key may call only `llm_api_routes`, so per-model limits cannot be discovered |
| Streamed, cap 64 through each field, a prompt longer than the cap | `length` and `completion_tokens` = 64 for every model except two: `gcp/gemini-3.1-pro-preview` reports 60 (also cap − 4 at 256, 1024, 4096), and `azure/gpt-5.3-codex` reports `stop` even at the cap |

`rits/zai-org/glm-5-1-fp8-agentic` is listed but answers 400 "Invalid model name"; that is a proxy
quirk, not ours. Curve Bender (also LiteLLM, also on the `openai-proxy` path) was not reachable
for a probe; the IBM proxy's `rits/*` models (the same RITS backend Curve Bender fronts) accept
`max_completion_tokens` and streamed usage.

### Decisions made during planning

- **The notice survives a reopen** through the replay stamp, not new storage.
- **Claude Code shows the notice live only.** Its adapter reports `max_tokens`, but its history
  reader (`harness-history-lib.mjs`) does not stamp the stop reason. Out of scope; a possible
  follow-up.
- **The notice looks like the quiet "Response interrupted" line**: small warning icon, muted
  text, under the reply. No new visuals.
- **RITS direct stays as it is** (`supportsUsageInStreaming: false`, `max_tokens`). It talks to
  vLLM with no LiteLLM in front and nothing on the platform wires it; only `openai-proxy` changes.
- **The limit is 32768**, the value the Curve Bender connection already uses. All working models
  accept it with room below the lowest model limit (64000). One value must cover every model on
  the connection, because LiteLLM refuses the model-info routes. A reply that reaches it takes
  about 8 minutes at the measured ~68 tokens/s.

### Decisions made during implementation

- **No architecture page changes.** agent-lifecycle is at its character cap, and its session-log
  paragraph already covers a stop reason that a replay source supplies.
- **A `length` stop reports the request's cap** in the extension's stream wrapper, so Gemini's
  cut replies stay too.
- **The stream wrappers load from pi-ai's root entry.** Their old subpath import failed inside
  Pi, so no wrapper ran on main; this also turns on the reasoning-order split from #4360.
- **`azure/gpt-5.3-codex` gets no notice.** LiteLLM reports `stop` at the cap, so Pi keeps the
  reply, but nothing can mark it as cut.
- **The sending tab marks the cut from its prompt response.** It closes the reply on that
  response, which arrives before `platform/turnEnded`, so the notification alone never marked it.

### Out of scope

- The "Response interrupted" notice (#3557) also lives only in the in-memory log; it is not made
  durable here.
- Slack and other channel turns do not report a cut reply.
- Whether Curve Bender's 32768 matches every model behind it.
- A pi-acp upstream issue for the missing `max_tokens`: ask the user before filing one.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | ✅ [Pi keeps a reply cut at the output limit](./01-pi-keeps-cut-reply.md) | Pi image: streamed usage on `openai-proxy`, a `length` stop reports the cap; pi-acp patch reports `max_tokens` and stamps the replayed reply | — |
| 02 | ✅ [The chat marks a reply cut at the output limit](./02-chat-marks-cut-reply.md) | `platformFrameMetaSchema.stopReason`; UI projection and muted line | 01 (for the Pi smoke test only) |
| 03 | [Pi's output limit on LiteLLM](./03-pi-output-limit-litellm.md) | IBM LiteLLM `MAX_TOKENS` 8192 → 32768 plus data migration; `openai-proxy` sends `max_completion_tokens` | 01 |

03 comes last on purpose: with the 8192 limit still in place, the smoke tests of 01 and 02 reach
the limit in about 2 minutes. After 03 the same test needs a reply of 32768 tokens.

## Conventions & glossary

- **Output limit**: the `maxTokens` Pi declares for a model and sends on each request. On
  `openai-proxy` it comes from `OPENAI_PROXY_MAX_TOKENS` (connection env), default 16384.
- **Cut reply**: an assistant reply whose model call ended because it reached the output limit.
  Pi records it as `stopReason: "length"`; ACP calls it `max_tokens`.
- **Replay stamp**: `_meta.platform.stopReason: "max_tokens"` on a replayed `session/update` frame
  of a cut reply. The UI treats it the same as `platform/turnEnded.stopReason: "max_tokens"`.
- Use `mise run` for every build, check and cluster step (see `AGENTS.md`); the
  [`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md) skill covers image builds and the
  dev cluster.
- Apply `/typescript-engineering` to TypeScript outside the UI (the Pi extension, the contract
  schema) and `/react-ui-engineering` to `packages/ui`.
- Code comments follow [`comment-guidelines.md`](../../guidelines/comment-guidelines.md); run
  `mise run check:comment-types` after code changes.
- No new tests. Verification is the existing suite (`mise run check`, `mise run test`) plus the
  manual smoke tests. Existing tests that call a changed signature are updated mechanically.
- Never print env values or Secrets from a pod. Pi's `models.json` and session files hold only
  placeholders and conversation text.

## Whole-feature smoke test

On the dev cluster, with images built from the branch head (Pi agent image, api-server, UI):

1. Create a Pi agent with an IBM LiteLLM connection created **before** the branch (or confirm
   the migration ran on one), and choose `aws/claude-sonnet-4-6`. In the pod, Pi's
   `~/.pi/agent/models.json` shows `maxTokens: 32768` and `maxTokensField:
   "max_completion_tokens"` for the `openai-proxy` models.
2. Ask: "Without tools, write a detailed 7000-word design document for a URL shortener, in this
   one reply." The reply completes with no output-limit line. Pi's session file shows a non-zero
   `usage.output` above 8192.
3. Ask for a reply that cannot fit (for example "Without tools, write a 40000-word design
   document in this one reply."). It stops at the limit (about 8 minutes). The muted line "Reply
   stopped at the output limit." shows under it.
4. Ask: "What was the last section heading in your previous reply?" The agent names it.
5. Close the chat, wait 5 s, reopen it: the line is still there. Delete the agent pod, wait for it
   to come back, reopen the chat: the reply and the line are still there.
6. Switch the model to `azure/gpt-6-astra` and send a short prompt: it answers.
7. `mise run check` and `mise run test` pass.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/4459.
