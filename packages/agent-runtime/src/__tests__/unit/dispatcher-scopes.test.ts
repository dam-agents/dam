import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Contribution } from "agent-runtime-api";
import { createDispatcher } from "../../modules/runtime-channel/dispatcher.js";
import { createPluginRegistry } from "../../modules/runtime-channel/infrastructure/plugin-registry.js";

describe("contribution dispatcher across harnesses", () => {
  /** TEST_SCENARIO: An image carrying two harnesses gives one contribution
   * kind two bindings, each harness's MCP config file its own. Both run on
   * every apply, and each keeps its state apart, so one harness's bookkeeping
   * never removes what the other wrote. */
  it("runs every binding of a kind, each with its own state directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "dispatch-"));
    const calls: { path: unknown; stateDir: string; count: number }[] = [];
    const registry = createPluginRegistry();
    registry.register({
      name: "mcp-entry",
      bind: (_kind, binding) => async (list, ctx) => {
        calls.push({
          path: binding.path,
          stateDir: ctx.pluginStateDir,
          count: list.length,
        });
      },
    });
    const dispatcher = createDispatcher({
      drivers: {
        "mcp-entry": [
          { binding: { impl: "mcp-entry", path: "a.json" }, scope: null },
          { binding: { impl: "mcp-entry", path: "b.toml" }, scope: "codex" },
        ],
      },
      registry,
      env: { agentHome: root, pluginStateRoot: root, log: () => {} },
    });
    const entry = {
      kind: "mcp-entry",
      name: "x",
      url: "https://x.example",
    } as Contribution;
    expect(await dispatcher.apply([entry])).toEqual([]);
    expect(calls).toEqual([
      { path: "a.json", stateDir: join(root, "mcp-entry"), count: 1 },
      { path: "b.toml", stateDir: join(root, "mcp-entry", "@codex"), count: 1 },
    ]);
  });
});
