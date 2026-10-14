# 01 — Delegation shows and returns in the asking chat on every harness

**Part of:** Delegation works the same on every harness — see [README](./README.md)

## Context

The runtime and the UI read a tool call's output only in the shape that Claude Code's adapter sends.
On Codex, Pi and Bob, the runtime therefore never notes which session spawned a sub-agent, so the platform's result turn opens in a new session.
On Codex, the chat also shows no output and no delegation for an MCP tool call.
This slice adds one reader that knows every adapter's shape, and makes the runtime and the UI use it.
The shapes are in the README's "What is broken" table.

## Implementation plan

Apply `/typescript-engineering` to steps 2–3 and `/react-ui-engineering` to step 4.

1. **Capture real frames first.**
   On the dev cluster, run one agent per harness (Codex, Pi, Bob; Claude Code as the baseline).
   In each, let the agent call `spawn_subagent` once, and run one driver-SDK script that prints a spawn line (for example `python3 -c 'import driver_sdk as d; print(d.spawn("Compute 2+2", "integer", harness="<own harness>", label="probe"))'`).
   Read the frames from the agent's session log (`sessions.history` on the pod, or the ACP WebSocket), and record for each `tool_call` and `tool_call_update`: `title`, `content`, `rawOutput`, `status`.
   Confirm the README table, and write down the MCP tool titles of Pi and Bob.
   Also note whether an adapter streams a shell command's output as several updates, each carrying only a part.
2. **Add the shared reader** in `packages/agent-runtime-api/src/modules/sessions/tool-output.ts`, and export it from [`packages/agent-runtime-api/src/index.ts`](../../../packages/agent-runtime-api/src/index.ts).
   It must stay browser-safe: no Node imports, no zod needed.
   - `toolOutputTexts(update: unknown): string[]` returns every text that a `tool_call` or `tool_call_update` carries:
     - standard `content` entries of type `content` whose inner block is `text` (Pi, Bob, and Claude Code where it sends them);
     - `rawOutput` as a string, or as a list of strings or `{text}` blocks (Claude Code);
     - `rawOutput.result` as a string, or with a `content` list of `{text}` blocks (Codex, Bob);
     - `rawOutput.content` as a list of `{text}` blocks (Pi).
   - `toolOutputTexts` returns each text once, and gets a new shape only when a captured frame shows it.
   - `toolNameOf(title: string): string` strips a server prefix from any harness's title: `mcp__<server>__`, `mcp.<server>.`, `Tool: <server>/`, and the Pi and Bob forms from step 1.
   - Give the module one `UNIT_BOUNDARY_DESCRIPTION` comment that says why it exists: each adapter shapes tool output its own way, and this is the one place that knows them.
3. **Runtime.**
   In [`sub-agent-spawn.ts`](../../../packages/agent-runtime/src/modules/acp/infrastructure/sub-agent-spawn.ts) and [`artifact-touch.ts`](../../../packages/agent-runtime/src/modules/acp/infrastructure/artifact-touch.ts), delete the local `textBlocks` and read from `toolOutputTexts(update)`.
   Keep `subAgentSpawnIn(frame)` and `artifactTouchIn(frame)` as they are, so [`acp-runtime.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts) and the existing tests do not change.
4. **UI.**
   - In [`session-projection.ts`](../../../packages/ui/src/modules/acp/session-projection.ts), when `mapToolContent(u.content)` yields nothing, build the chip's `content` from `toolOutputTexts(u)` as text blocks.
     Do this in `handleToolCall` and `patchToolChip`.
     A harness that sends `content` (Claude Code, Pi, Bob) must look exactly as before.
   - In [`sub-agent-chips.ts`](../../../packages/ui/src/modules/invocations/lib/sub-agent-chips.ts), match on `toolNameOf(chip.title) === "spawn_subagent"` and `=== "await_subagents"`, and remove the two regexes.
   - If step 1 showed that an adapter streams command output in parts and a script's spawn line gets lost from its chip, keep the earlier text in `patchToolChip` for that case.
     Change nothing there if no captured frame needs it.
5. **Docs.**
   In [`invocations.md`](../../architecture/invocations.md), "The Driver's chat is the anchor" and the outcome-turn paragraph in "Sub-agent tools": say that the runtime and the chat read spawn lines from every harness's tool-output shape through one shared reader.
   Update `Last verified:`.
   Run `mise run fix:markdown`.

## Acceptance criteria

- [ ] On Codex, Pi and Bob, a `spawn_subagent` call shows as the delegation chip in the chat, with its sub-agent; an `await_subagents` call shows its summary title ("Waited on N sub-agents — …").
- [ ] On Codex, an MCP tool call's chip shows its output text.
- [ ] On all four harnesses, a result turn for a sub-agent the agent stopped waiting for continues the session that spawned it.
- [ ] Claude Code chips and result turns behave exactly as before.
- [ ] `artifact-touch.ts` and `sub-agent-spawn.ts` contain no copy of the shape logic; it exists only in `agent-runtime-api`.
- [ ] `mise run //packages/agent-runtime-api:check`, `mise run //packages/agent-runtime:check`, `mise run //packages/agent-runtime:test`, `mise run //packages/ui:check`, `mise run //packages/ui:test` and `mise run check:comment-types` pass.

## Smoke test

1. Existing suite: `mise run //packages/agent-runtime:test` (covers `sub-agent-spawn.test.ts`, `artifact-touch.test.ts`) and `mise run //packages/ui:test` (covers `session-projection.test.ts`, `fan-out.test.ts`).
2. Live, on a dev deployment built from the branch (`mise run cluster:build -- api-server ui agents`), for Codex, Pi and Bob:
   - In a chat, ask: "Hand this to one platform sub-agent on your own harness and wait for it: compute 6 × 7, result as an integer."
     The chat shows the delegation chip with the sub-agent, and then the result.
   - In a new chat, ask for a sub-agent that sleeps 2 minutes and then reports 42; tell the agent to end its turn without waiting.
     Close the chat.
     After 3 minutes, reopen the agent: the result turn is in the **same** chat, and no new session appeared.
3. Take screenshots of the chip on Codex, Pi and Bob for the PR.

Print a short manual guide with these steps for the user when the slice is done.
