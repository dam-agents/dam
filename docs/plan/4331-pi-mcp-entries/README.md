# Pi agents get the platform's MCP tools

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4331

## Goal

A Pi agent gets the same platform tools, knowledge bases and granted MCP servers as an agent
on any other harness. It calls them like its built-in tools. A Pi sub-agent calls
`report_result`, and the parent receives the result instead of a timeout.

This holds for new Pi agents and for Pi agents that already exist when the fix rolls out. An
existing agent gets its entries on its first boot on the new image, with no grant change.

## Approach

Read [runtime delivery](../../architecture/runtime-delivery.md) (manifest, drivers, `hello`,
invariants) and [connections](../../architecture/connections.md) (built-in contributions,
`mcp-entry`) before you start.

**Why Pi has no tools today.** The platform reaches every harness through `mcp-entry`
contributions: the built-in `platform-outbound` entry always, the `knowledge-bases` entry
while the agent holds a share, and one entry per granted MCP Connection. The agent-runtime's
`mcp-entry` driver writes them to a file. The built-in binding writes `$HOME/.mcp.json`
(Claude Code reads it). Codex and Bob override the binding in their image's
`runtime-manifest.yaml` and point it at their own file. Pi's manifest has no override, so
the entries land in `$HOME/.mcp.json`, which Pi ignores.

**Pi's MCP format (Pi 1.0.2, as pinned on main).** Pi reads user-level servers from
`~/.pi/agent/mcp.json` under `mcpServers`. An HTTP server is `{ type: "http", url, headers }`,
which is the shape the default binding already writes. Server names may contain only
letters, digits, `_` and `-`. Connection names are lowercase, digits and hyphens, so they all
pass. Each server takes an `exposure`. The default is `codemode`, which hides the tools
behind Pi's scripting tool. `direct` declares them to the model like a built-in tool. Pi's
first prompt also waits up to 10 s for `direct` servers to connect. Upstream reference:
`docs/mcp.md` in the `@earendil-works/pi-coding-agent` package.

**Slice 01: the manifest override.** Bind `mcp-entry` in Pi's manifest to
`$HOME/.pi/agent/mcp.json` and add `exposure: direct` through `extraFields`. The driver
already supports `path`, `keyPath` and `extraFields`, so no driver code changes. Every entry
gets `direct`, including user MCP Connections. That matches Claude Code and Codex, which also
declare every MCP tool to the model. The cost: a large or slow user server makes the context
bigger and can delay the first prompt by up to 10 s.

**Why 01 does not reach existing agents.** The agent-runtime keeps its applied version and
state hash on the PVC, and they survive an image update. On boot, `hello` reports that cursor.
The api-server dispatches only when the cursor is behind the outbox version. Even when a push
arrives, the runtime skips every driver when the hash is unchanged. A new binding therefore
writes nothing until some grant changes the snapshot. New agents and spawned sub-agents start
with empty state, so 01 alone fixes them.

**Slice 02: re-apply when the bindings change.** The agent-runtime records a fingerprint of
its resolved contribution-driver bindings in its runtime state. On boot, if the fingerprint
differs from the recorded one, it resets its applied cursor to the "never applied" state. Then
`hello` reports it as behind, the worker pushes the current snapshot, and every driver runs
again. This is general: any later binding change on any harness also reaches existing agents.
On the first rollout no agent has a recorded fingerprint, so every agent re-applies once.
Drivers are idempotent, so this is safe.

Verified facts that the slices rely on:

- The delivery worker never skips a row that is already applied. It always pushes the current
  row version (`packages/api-server/src/modules/runtime-delivery/services/worker-handler.ts`).
- `hello` sends `lastAppliedVersion || undefined`, and the api-server enqueues when the
  desired version is greater than the reported version. An agent at version 0 is therefore
  always behind
  (`packages/agent-runtime/src/modules/runtime-channel/compose.ts`,
  `packages/api-server/src/modules/runtime-delivery/services/hello-handler.ts`).
- A manifest `drivers:` entry replaces the whole built-in binding. It does not merge with it.
  Only `impl` defaults (`resolveDrivers` in
  `packages/agent-runtime/src/modules/runtime-channel/manifest.ts`). The override must
  therefore state `path` and `keyPath` itself.

**Out of scope:**

- Slack and Telegram turn copy names tools as `mcp__platform-outbound__…`. Pi names them
  `mcp__platform_outbound__…`, because it replaces `-` with `_`. The model can call only
  declared tools, so we expect it to choose the right one. The whole-feature smoke test checks
  this. A copy change is a follow-up, and only if the smoke test fails.
- The relay's allow-once for platform tools matches only the hyphen form
  (`packages/api-server/src/core/platform-mcp.ts`). This has no effect on Pi: pi-acp asks
  for permission only for extension dialogs, never for tool calls.
- An existing Pi agent keeps a stale `~/.mcp.json` that holds the platform entries. Pi
  ignores it. We do not delete it.
- #4228's Pi exception is an edit to the issue text, not code. It is not on this branch.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 ✅ | Pi reads the platform's MCP entries | `mcp-entry` override in Pi's manifest (`~/.pi/agent/mcp.json`, `exposure: direct`); Pi README | — |
| 02 ✅ | Re-apply the snapshot when the image's driver bindings change | Bindings fingerprint in the agent-runtime's runtime state; the cursor resets on mismatch; runtime-delivery page | 01 (only for its Pi smoke test) |

## Conventions & glossary

- **Contribution / `mcp-entry`**: an item of an agent's desired state. `mcp-entry` is an MCP
  server to expose to the harness. See [connections](../../architecture/connections.md).
- **Binding**: a `drivers:` entry in an image's `runtime-manifest.yaml`, resolved over the
  built-in defaults. It decides which driver impl handles a kind and how it is configured.
- **Applied cursor**: the agent-runtime's `lastAppliedVersion` + `lastAppliedHash` in its
  runtime state (`.platform` on the PVC). `hello` reports it.
- **Exposure**: Pi's per-server setting that controls how MCP tools reach the model.
- Apply `/typescript-engineering` to the agent-runtime change in 02.
- Follow [comment guidelines](../../guidelines/comment-guidelines.md) for the manifest's YAML
  comment and any code comment. Run `mise run check:comment-types` after you change code.
- Follow [documentation guidelines](../../guidelines/documentation-guidelines.md) for the
  architecture page in 02 and the Pi README in 01.
- Do not add tests. The existing suite (`mise run //packages/agent-runtime:test`, `mise run
  check`) plus the manual smoke tests are the verification.
- Never hardcode the brand in copy or code.

## Whole-feature smoke test

Use the local dev cluster. Read the `cluster-ops` skill first. Before you build the branch,
create the "existing" agent on main's images.

1. On the cluster's current (main) images, create a Pi agent. Open its terminal and run
   `pi mcp list`. Expect "No MCP servers configured".
2. Build the branch's agent images and roll them: `mise run cluster:build -- agents`.
3. Restart the agent from step 1. Do not change any grant. In its terminal,
   `~/.pi/agent/mcp.json` must hold `platform-outbound` with `"exposure": "direct"`, and
   `pi mcp list` must show it connected with its tools. The agent-runtime log must show that
   the bindings changed and that the full contribution set was dispatched.
4. In a chat with that agent, ask it to list its schedules. The model must call
   `mcp__platform_outbound__list_schedules` directly, without writing a codemode script.
5. From a Claude Code agent, spawn a sub-agent on the `pi` harness with a small result schema.
   The invocation must finish as done with a result, not fail with "liveness deadline
   exceeded".
6. If Slack is wired on the dev cluster, bind the Pi agent and mention it. It must reply in the
   thread through the platform tool.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/4331.
