# 01 — Pi reads the platform's MCP entries

**Part of:** Pi agents get the platform's MCP tools — see [README](./README.md)

## Context

Pi's image manifest has no `mcp-entry` override, so the agent-runtime writes the platform's
MCP entries to `$HOME/.mcp.json`. Pi never reads that file. This slice points the binding at
Pi's own file, `$HOME/.pi/agent/mcp.json`, and marks every entry `exposure: direct`, so Pi
declares the tools to the model. It is a manifest change plus docs. The `mcp-entry` driver
already supports every field this needs. After this slice, every Pi agent created on the new
image, including every spawned Pi sub-agent, has the platform's tools. Existing agents are
slice 02.

## Implementation plan

1. Edit `packages/agents/pi-agent/rootfs/app/runtime-manifest.yaml`. Add an `mcp-entry` entry
   under `drivers:`, beside `harness-config`:

   ```yaml
   mcp-entry:
     path: "$HOME/.pi/agent/mcp.json"
     keyPath: mcpServers
     extraFields:
       exposure: direct
   ```

   - State `path` and `keyPath` explicitly. A manifest entry replaces the whole built-in
     binding (`resolveDrivers` in
     `packages/agent-runtime/src/modules/runtime-channel/manifest.ts`). Only `impl` defaults,
     to `mcp-entry`.
   - Keep the default `type: "http"` / `url` / `headers` shape. Pi reads it as-is, so set no
     `urlKey` and no `headersKey`.
   - `extraFields` is a string record that the driver spreads into each entry
     (`packages/agent-runtime/src/modules/runtime-channel/drivers/mcp-entry-plugin.ts`).
     `exposure` is not a reserved key, so the binding schema accepts it.
2. Rewrite the manifest's header comment the way the Codex and Bob manifests explain their
   overrides. Give the non-obvious facts only:
   - Pi reads MCP servers only from its own `~/.pi/agent/mcp.json`, never from
     `$HOME/.mcp.json`.
   - Pi's default exposure (`codemode`) hides MCP tools behind its scripting tool, so a
     sub-agent could not call `report_result` directly. `direct` declares them like a
     built-in tool.
   - Every entry gets `direct`, including user Connections. That matches the other harnesses,
     and the cost is context size and up to 10 s of first-prompt wait for a slow server.

   Follow [comment guidelines](../../guidelines/comment-guidelines.md). Do not cite issues.
3. Update `packages/agents/pi-agent/README.md`:
   - In the file layout, note that the platform writes `~/.pi/agent/mcp.json` at runtime. It
     is not seeded from `working-dir`.
   - Add a short "MCP servers" section, like Bob's README line 38. MCP servers arrive as
     runtime-channel contributions written to `~/.pi/agent/mcp.json` with `exposure: direct`,
     not through `session/new.mcpServers`. pi-acp advertises no MCP capabilities, so the file
     is the only path. `pi mcp list` in the terminal shows them.
4. Do not touch `$HOME/.mcp.json` cleanup, the driver, or the api-server.

## Acceptance criteria

- [ ] `resolveDrivers(loadManifest(<pi manifest>))["mcp-entry"]` equals
      `{ impl: "mcp-entry", path: "$HOME/.pi/agent/mcp.json", keyPath: "mcpServers",
      extraFields: { exposure: "direct" } }`, and the driver's binding schema accepts it.
      Confirm this with a node one-liner or by reading the code. Do not add a test.
- [ ] `mise run //packages/agent-runtime:test` passes. The existing
      `manifest-resolve.test.ts` loads Pi's manifest.
- [ ] `mise run check` passes.
- [ ] A new Pi agent on the branch image has `~/.pi/agent/mcp.json` with `platform-outbound`
      (`type`, `url`, `headers`, `exposure: "direct"`), and `pi mcp list` shows it connected.
- [ ] A Pi sub-agent spawned with a result schema finishes as done with its result.

## Smoke test

1. `mise run //packages/agent-runtime:test` and `mise run check`.
2. On the local dev cluster (read the `cluster-ops` skill first), build and roll the agent
   images: `mise run cluster:build -- agents`. For a faster one-image path, see the skill.
   Check the running pod's image age. Do not trust the exit code.
3. Create a new Pi agent. In its terminal:
   - `cat ~/.pi/agent/mcp.json`: `mcpServers.platform-outbound` has `"type": "http"`, the
     harness URL, its headers, and `"exposure": "direct"`.
   - `pi mcp list`: `platform-outbound` is connected and lists tools such as
     `report_result` and `list_schedules`.
4. In the agent's chat, ask "list my schedules". The tool-call card must show
   `mcp__platform_outbound__list_schedules`, called directly, not through `codemode`.
5. From a Claude Code agent, spawn a sub-agent on the `pi` harness with a one-field result
   schema, for example `{ "answer": string }`. The invocation must end as done with a result
   within a few minutes.

Then print a short manual guide so the user can repeat steps 3–5 by hand.
