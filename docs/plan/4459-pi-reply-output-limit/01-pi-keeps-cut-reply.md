# 01 — Pi keeps a reply cut at the output limit

**Part of:** Pi agents keep a reply that hits the output limit — see [README](./README.md)

## Context

Pi removes a reply that stops at the output limit, because the `openai-proxy` provider never asks
for token counts and Pi reads "stopped at the limit with 0 output tokens" as a full context. This
slice turns streamed usage on for `openai-proxy`, so Pi keeps the reply and reports real token
counts. It also makes the in-memory pi-acp patch report the cut: the turn ends with ACP
`max_tokens`, and a reopened chat's replayed reply carries the replay stamp. Everything is in the
Pi agent image; nothing in the platform changes. The UI shows nothing new until 02.

## Implementation plan

Apply `/typescript-engineering` to the extension.

1. **Streamed usage on `openai-proxy`**,
   [`pi-dynamic-providers/index.ts`](../../../packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/extensions/pi-dynamic-providers/index.ts):
   - Give `ProviderSpec` an optional per-spec compat override (a partial of the model config's
     `compat`). `buildModelConfig` takes the spec (or its override) and spreads it over the shared
     defaults.
   - `openai-proxy` overrides `supportsUsageInStreaming: true`. `rits` keeps the shared default
     `false` (vLLM direct, untested; see the README's decisions).
   - Nothing else changes: `reasoningBeforeContent` already keeps `usage` on the content half of a
     split chunk, and LiteLLM's final usage chunk has `choices: []`, so it passes through
     untouched. `mise run //packages/agents:check:pi-reasoning-order` covers that path.
   - 03 adds `maxTokensField` to the same override, so keep the override shape general.
   - The stream wrapper also reports a `length` stop's `completion_tokens` as the request's cap
     (`max_completion_tokens` or `max_tokens` in the request body) when the provider reports less
     but more than 0: `gcp/gemini-3.1-pro-preview` reports 4 below the cap on every cut. Both
     wrappers share one SSE line rewriter.
   - Load pi-ai's completions stream from the package root (`openAICompletionsApi`). Pi resolves
     an extension's pi-ai imports only for the root, `compat`, `oauth` and `providers/all`, so the
     old `@earendil-works/pi-ai/api/openai-completions` import failed in the image and the
     provider ran without the extension's `fetch` (found during implementation; the reasoning-order
     fix from #4360 never ran either).

2. **The turn ends with `max_tokens`**,
   [`pi-acp-patch.mjs`](../../../packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/pi-acp-patch.mjs).
   Add helpers to the `globalThis[Symbol.for("platform.pi-acp-patch")]` object and three edits,
   in the style of the existing ones (exact `find`, exact `count`):
   - `case "turn_end": {` in `handlePiEvent` records `ev.message?.stopReason` on the session. Pi's
     `turn_end` event carries the turn's assistant message (`AgentEvent` in `pi-agent-core`).
   - `startTurn(t) {` resets the recorded stop reason with `cancelRequested`.
   - `settleTurn` resolves `max_tokens` instead of `end_turn` when the recorded stop reason is
     `length`. `cancelled` still wins.
   - The error path (`proc.prompt(...).catch`) and the patch's own `settleTurnsOnExit` stay as
     they are.

3. **The replayed reply carries the stamp**, same file. In `loadSession`'s replay loop, the
   `role === "assistant"` branch sends one `agent_message_chunk` per message. When the message's
   `stopReason` is `length`, add `_meta: { platform: { stopReason: "max_tokens" } }` to the
   `sessionUpdate` params, beside `sessionId` and `update` (params level, where the runtime and
   the UI read `_meta.platform`). Other messages stay unchanged.
   - Every anchor above occurs exactly once in the pi-acp 0.0.34 bundle (checked during
     planning): `case "turn_end": {`, `startTurn(t) {`, the `settleTurn` reason line, and the
     assistant replay block that starts at `normalizePiAssistantText(m?.content)`.
   - The patch still applies all edits or none. One mismatch leaves pi-acp unpatched and logs
     `pi-acp-patch: not applied …`, which also drops the session fixes. Keep `PATCHED_VERSION`.

4. **Messages that name the patch's reason.** `UPSTREAM_ISSUE` and the "not applied" message
   name only svkozak/pi-acp#152. Reword them so they cover both gaps: concurrent sessions (#152)
   and the missing `max_tokens` stop reason (no upstream issue; ask the user before filing one).
   Update
   [`check/pi-acp-patch`](../../../packages/agents/.mise/tasks/check/pi-acp-patch) the same way.

5. **Pi agent README**,
   [`packages/agents/pi-agent/README.md`](../../../packages/agents/pi-agent/README.md):
   - Rename the section "pi-acp concurrent sessions" to "pi-acp patch". Fix its two references:
     the layout tree comment beside `pi-acp-patch.mjs`, and the check task's message.
   - Add the stop-reason fix to the section's list: a cut turn ends with `max_tokens`, and the
     replayed reply carries `_meta.platform.stopReason`.
   - In the `pi-dynamic-providers` paragraph, say that `openai-proxy` asks for streamed token
     counts and `rits` does not.

Side effect to accept, not to fix: a Pi turn cut at the limit now reports `max_tokens`, like a
Claude Code turn. `dam run` prints that stop reason and exits with its "run stopped" code instead
of 0 (`stopExitCode` in `packages/cli/src/modules/chat/commands/run.ts`). No other code reads a
turn's stop reason; a schedule's "stop reason" is the schedule's own state.

## Acceptance criteria

- [ ] With an IBM LiteLLM connection, a short Pi reply's assistant entry in Pi's session file
      (under `~/.pi/agent/sessions/`) has `usage.output` above 0.
- [ ] A reply cut at 8192 tokens has `stopReason: "length"` and `usage.output: 8192` in the
      session file, and no `context_edit` with `replacement: null` targets it.
- [ ] After that reply, the agent answers a question about the reply's content correctly.
- [ ] The cut turn's `platform/turnEnded` notification carries `stopReason: "max_tokens"`. A
      normal turn still carries `end_turn`.
- [ ] After the agent pod restarts, the reopened chat contains the cut reply, and its replayed
      `session/update` frame carries `_meta.platform.stopReason: "max_tokens"`.
- [ ] The agent pod log has no `pi-acp-patch: not applied` line.
- [ ] With `gcp/gemini-3.1-pro-preview`, a cut reply also stays, with `usage.output` 8192.
- [ ] `mise run //packages/agents:check`, `mise run check:comment-types` and `mise run check`
      pass.

## Smoke test

1. Rebuild and load the Pi agent image on the dev cluster: `mise run cluster:build -- agents`
   (the [`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md) skill covers failures).
2. Create a Pi agent with an IBM LiteLLM connection; in Agent Setup choose
   `aws/claude-sonnet-4-6`.
3. Ask: "Without tools, write a detailed 7000-word design document for a URL shortener, in this
   one reply." Wait until it stops mid-text (about 2 minutes).
4. In the browser's developer tools, on the chat's WebSocket, find the `platform/turnEnded` frame
   for that turn: `stopReason` is `max_tokens`.
5. Read this chat's session file (the newest one) without printing env:
   `mise run cluster:kubectl -- exec -n platform-agents <agent-pod> -c agent -- sh -c 'f=$(ls -t ~/.pi/agent/sessions/*/*.jsonl | head -1); grep -o "\"stopReason\":\"length\".\{0,300\}" "$f"; grep -c "\"context_edit\"" "$f"'`
   shows the cut reply with `"output":8192`, and the `context_edit` count is 0.
6. Ask: "What was the last section heading in your previous reply?" The agent names a heading
   from the document.
7. Delete the agent pod (`mise run cluster:kubectl -- delete pod -n platform-agents <agent-pod>`),
   wait for it to come back, and reopen the session. The document is there, and its replayed
   `session/update` frame on the WebSocket carries `_meta.platform.stopReason: "max_tokens"`.
8. `mise run cluster:kubectl -- logs -n platform-agents <agent-pod> -c agent | grep pi-acp-patch`
   prints nothing.
9. Switch the session model to `gcp/gemini-3.1-pro-preview` and repeat step 3. The cut reply
   stays: its session-file entry has `stopReason: "length"` and `"output":8192`, and no new
   `context_edit` appears.

Print a short version of these steps for the user so they can confirm by hand.
