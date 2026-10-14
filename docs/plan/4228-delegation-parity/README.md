# Delegation works the same on every harness

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4228

## Goal

On every shipped harness — Claude Code, Codex, Pi and Bob — delegation works as it does on Claude Code.
An agent on any harness reads one delegation guide that fits its harness.
It starts a sub-agent with the platform's tools.
The chat shows the delegation where the agent started it.
The result comes back to the chat that asked, also after the user has left.

## Decisions made while planning

The issue is older than #4204 and #4342, so some of its text is stale.
These decisions replace it where the two differ.

- **Pi is in scope.**
  Pi has MCP since #4342, so the issue's "Pi is the one known exception" no longer holds.
- **Script results stay out of scope.**
  A script spawn gets no result turn, as before.
  The guide sends long waits and fan-outs to the tools, which get a result turn on every harness.
  A script is only for orchestration logic that finishes inside one shell command, and it runs in the foreground.
- **No native subagent is added to Pi.**
  The guide and the `spawn_subagent` description say "your harness's own subagent, if it has one."
- **No compare-harnesses section and no cost guidance.**
  The tools already let an agent spawn on two harnesses and compare the answers.
  Per-sub-agent cost belongs to #3427.
- **Proof is one live run:** 4 harnesses × 4 checks, as a table in the PR (see the whole-feature smoke test).
  No new tests.
- **Bob runs live.**
  The owner adds a Bob connection on the dev cluster before the smoke test.
- **Codex's missing platform instructions stay a separate bug** (#4583).
  The skill and the tool descriptions reach Codex without them.
- Nothing is posted on #3427 or #4403.

## Decisions made while implementing

- **Codex and Pi shell output is in scope of 01.**
  Both adapters send a shell command's output only in `_meta` (`terminal_output_delta` for Codex, `terminal_output` for Pi), one new part per update.
  Nothing read it, so every Codex and Pi shell chip showed no output, and a script spawn never drew its delegation chip.
  The shared reader returns each part, and the chat adds it to the chip's text.
- **The frame shapes come from the installed adapter code**, not from a capture before coding.
  The live smoke test confirms them.
- **The UI fallback reads only what Claude Code never sends to our client**: a result object in `rawOutput`, and `_meta` terminal parts.
  Claude Code puts its raw tool result in `rawOutput` and also renders it into `content`, so its chips stay as they were.
- **A chip keeps the last 50 KB of a streamed shell output.**
  Past Pi's own 50 KB window, pi-acp sends the whole new window as a "part", so a longer Pi output may show some lines twice near the cut.
- **Codex may stop `await_subagents` at its MCP tool timeout** (believed to be 60 s, against the 240 s long poll).
  Check it in smoke check 1 on Codex; if it holds, raising Codex's tool timeout for the platform server is a decision for the owner.
- **The live smoke tests run later, on the shared dev cluster**, after the owner says another job on it is done.
- **The first live run (2026-10-14) added 03 and 04.**
  Claude Code and Bob passed all four checks.
  Codex could not spawn with the tool (text schema), every Pi wait hit Pi's 60-second MCP timeout, a wait's result could also be pushed as a turn, and every Codex and Pi sub-agent got 401 from its provider.
  The owner chose to fix them all here and re-run the 4 × 4.
- **Pi's wait is kept alive with MCP progress messages**, not by a shorter wait or a raised Pi timeout.
  Pi restarts its 60-second timeout on each one; a Pi wait then ran 130 seconds and returned.
- **Every agent created or removed on the cluster cuts open waits, and that stays out of scope.**
  The api-server's waypoint reloads on each agent create or delete and closes old connections 45 seconds later; the agent's gateway reuses its old connection, so even a call sent after the reload is cut.
  Shorter waits do not prevent this, so the wait stays at four minutes, and the tool description and the skill tell the agent to call again after a connection error; the sub-agents keep running.
  The owner asked for a separate issue for the network cause, drafted but not filed yet.
  No image is built from this branch before then.

## Approach

Read [invocations](../../architecture/invocations.md) first: the sections "Sub-agent tools" and "The delegation record" own this feature.
Also relevant: [agent-skills](../../architecture/agent-skills.md) (image-skill lifecycle), [agent-images](../../architecture/agent-images.md) (the base holds the shared skills) and [runtime-delivery](../../architecture/runtime-delivery.md) (the `sub-agent-outcome` kind).

### What already works on every harness

- **One image carries every harness.**
  The build copies every harness's `rootfs/` into the default image (`packages/agents/.mise/tasks/oci`, line 227).
  So the `spawn-subagent` skill already sits in every agent's `~/.agents/skills`.
  Codex reads that folder itself; Bob and Pi link their skill folders to it.
  Only the skill's source folder belongs to Claude Code.
- **A tool spawn gets a result turn from the platform**, whatever the harness (#4204).
- **A foreground command in a running turn survives the user leaving** ([sessions](../../architecture/sessions.md), "the turn runs to completion").
- **The platform saves a sub-agent's conversation from the runtime's own session log**, not from a harness file, so that works on every harness.

### What is broken

Each ACP adapter shapes a finished tool call's output in its own way.
Both readers on our side know only Claude Code's shape.

| Harness (adapter)                              | Output of an MCP tool call                                                                                           | Title of an MCP tool call                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Claude Code                                    | `rawOutput` is text, or a list of text blocks                                                                        | `mcp__platform-outbound__spawn_subagent`                      |
| Codex (`@agentclientprotocol/codex-acp` 2.1.1) | `rawOutput = {result, error}`, where `result` is the MCP result with `content: [{type: "text", text}]`; no `content` | `mcp.platform-outbound.spawn_subagent`                        |
| Pi (`pi-acp` 0.0.34)                           | standard `content: [{type: "content", content: {type: "text", text}}]`; `rawOutput` is Pi's result object            | `mcp__platform_outbound__spawn_subagent` (already matched)    |
| Bob (2.0.6)                                    | standard `content` with the text; `rawOutput = {result}`                                                             | `Running Spawn Subagent (platform-outbound)`, a display label |

Sources: codex-acp `src/tool-calls/reporters/McpToolReporter.ts` at `v2.1.1`; pi-acp `src/acp/session.ts` at `v0.0.34` (`tool_execution_end`); Bob's bundle `dist/bob` (`onToolResult`, `TQe`).

- **The runtime** reads only `rawOutput` as text or as a list ([`sub-agent-spawn.ts`](../../../packages/agent-runtime/src/modules/acp/infrastructure/sub-agent-spawn.ts), and the same copy in [`artifact-touch.ts`](../../../packages/agent-runtime/src/modules/acp/infrastructure/artifact-touch.ts)).
  So on Codex, Pi and Bob it never notes a spawn line, and a result turn opens in a **new** session instead of the one that asked.
- **The UI** reads only the standard `content` (`mapToolContent` in [`session-projection.ts`](../../../packages/ui/src/modules/acp/session-projection.ts)), and it matches only two title shapes ([`sub-agent-chips.ts`](../../../packages/ui/src/modules/invocations/lib/sub-agent-chips.ts)).
  So on Codex a tool chip shows no output and no delegation, and on Pi and Bob the spawn and await chips may not be recognised.
- **The guide** lives in Claude Code's image folder and gives advice that fits only Claude Code: "run a long fan-out script as a background task," and "use your harness's own subagent" (Pi has none).

### How the fix fits

- **One reader for tool output, in one place.**
  A pure, browser-safe helper in `agent-runtime-api` returns every text a tool call update carries, whatever the adapter, and the bare tool name from any harness's title.
  The runtime (spawn tracking and artifact touches) and the UI (chip content and chip matching) both use it.
  When an adapter changes its shape, one file changes.
- **One guide, in the base image.**
  The skill moves to `packages/agents/base/` at the same image path, `/app/working-dir/.agents/skills/spawn-subagent`, so existing agents get the new text through image-skill reconciliation.
  It is rewritten so that no advice depends on one harness.

## Sub-issues

| #     | Title                                                                                                 | Scope                                                                                                                                                                                  | Depends on                                                     |
| ----- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| ✅ 01 | [Delegation shows and returns in the asking chat on every harness](./01-tool-output-every-harness.md) | Shared tool-output reader in `agent-runtime-api`; runtime spawn tracking and artifact touches use it; UI chip content falls back to `rawOutput`; chip matching uses the bare tool name | —                                                              |
| ✅ 02 | [One delegation guide for every harness](./02-delegation-guide.md)                                    | Skill moves to the base image and is rewritten harness-neutral; base `AGENTS.md` and the `spawn_subagent` description reworded; skill manifest; architecture docs                      | — (do it after 01, so the smoke test runs on the full feature) |
| ✅ 03 | [Tool spawns and waits work on every harness](./03-tool-calls-every-harness.md)                       | Codex text schema parsed; progress messages keep Pi's wait alive; lease grace after a wait; MCP calls labelled as tools                                                                | 01, 02                                                         |
| 04    | [Codex and Pi reach their provider with addressed injection](./04-addressed-provider-key.md)          | Codex image env no longer shadows the provider placeholder; Pi reads it and sends it with discovery                                                                                    | —                                                              |

## Conventions & glossary

- **Tool spawn** — a sub-agent started with the `spawn_subagent` MCP tool (`origin = 'tool'`).
  Its outcome is delivered as a turn when nobody waits for it.
- **Script spawn** — a sub-agent started from the driver SDK in a script (`origin = 'script'`).
  It gets no result turn.
- **Result turn** — the `sub-agent-outcome` delivery that opens or continues a session with a sub-agent's result.
- **Spawn line** — `[invoke] spawned <label> -> <id>`, printed by `spawn_subagent` and by both SDKs.
  The runtime and the chat read it from a tool call's output.
- **Adapter** — the ACP bridge of a harness: claude-agent-acp, codex-acp, pi-acp, or Bob's own `bob acp`.
- Apply `/typescript-engineering` to `agent-runtime-api`, `agent-runtime` and `api-server` code, and `/react-ui-engineering` to `packages/ui`.
- Code comments follow [`docs/guidelines/comment-guidelines.md`](../../guidelines/comment-guidelines.md); run `mise run check:comment-types` after any code change.
- Docs follow [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md): one sentence per line (`mise run fix:markdown`), and update `Last verified:` on every architecture page you touch.
- Agent-facing text (the skill, `AGENTS.md`, tool descriptions) states principles and non-obvious facts, not step-by-step recipes for edge cases.
- No new tests.
  Verification is the existing suite plus the manual smoke tests.
  If a signature change breaks an existing test, adjust that test.
- Never hardcode the brand.
- For the dev cluster, use the [`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md) skill.
  If Codex agents still fail to start with `codex-acp … EACCES` on the arm64 cluster, apply the known local `chmod` workaround, and never commit it.

## Whole-feature smoke test

Run it after 02, on a dev deployment built from the branch (`mise run cluster:build -- api-server ui agents`), with a provider for each harness.
The owner adds the Bob connection first (a Bob Shell key; IBM LiteLLM answers only inside the VPN).
A child must run on its parent's provider, so for check 3 the parent can be on the same harness as the child; it then names a need other than `different-harness`, such as `checked-result`.

For each harness — Claude Code, Codex, Pi, Bob — as the **parent** (checks 1, 2, 4) and as the **child** (check 3):

| #   | Check                                                                                         | Passes when                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ask the agent to hand one task to a sub-agent and wait for it                                 | It calls `spawn_subagent` and `await_subagents`; the chat shows the delegation chip with the sub-agent, and the result arrives in the same turn |
| 2   | Ask for a sub-agent task that takes a few minutes; let the agent end its turn; close the chat | The sub-agent ends; reopening the agent shows the result turn **in the same session**, not in a new one                                         |
| 3   | Spawn a sub-agent **on** this harness                                                         | The Invocation goes `done` with a schema-valid result through `report_result`                                                                   |
| 4   | Ask for a long fan-out of 3 tasks                                                             | The agent follows the guide: it uses the tools, not a background script, and it never says that something runs without checking                 |

Put the 4 × 4 table in the PR with the commit and "a dev deployment."
Never name the local cluster.
Add screenshots of the delegation chip on Codex, Pi and Bob (the UI proof rule in `AGENTS.md`).

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/4228.
