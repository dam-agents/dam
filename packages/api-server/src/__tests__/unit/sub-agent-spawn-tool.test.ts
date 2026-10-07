import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSubAgentTools } from "../../apps/harness-api-server/sub-agent-tools.js";
import type {
  DriverOps,
  SpawnRequest,
} from "../../apps/harness-api-server/driver-ops.js";

/**
 * TEST_OVERVIEW: spawn_subagent hands the spawn route what the driver SDK
 * would: the model, mode and config options the agent passes flat become the
 * request's harness config, so the platform records them and runs its checks,
 * and a spawn that names none sends no harness config at all.
 */

type Handler = (
  args: Record<string, unknown>,
  extra: { signal: AbortSignal },
) => Promise<unknown>;

function setup() {
  const tools = new Map<string, Handler>();
  const server = {
    tool: (name: string, _d: unknown, _shape: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  const spawned: SpawnRequest[] = [];
  const ops = {
    harness: async () => "claude-code",
    spawn: async (body: SpawnRequest) => {
      spawned.push(body);
      return { ok: true, id: "agent-child" };
    },
  } as unknown as DriverOps;
  registerSubAgentTools(server, {
    ops,
    awaits: { markAwaited: async () => {}, markCollected: async () => {} },
  });
  const spawn = tools.get("spawn_subagent")!;
  return {
    spawn: (args: Record<string, unknown>) =>
      spawn(
        {
          needs: ["isolation"],
          prompt: "go",
          schema: { type: "integer" },
          harness: "codex",
          ...args,
        },
        { signal: new AbortController().signal },
      ),
    spawned,
  };
}

describe("spawn_subagent harness config", () => {
  it("folds model, mode and configOptions into harnessConfig", async () => {
    const s = setup();
    await s.spawn({
      model: "haiku",
      mode: "bypassPermissions",
      configOptions: { effort: "low" },
    });
    expect(s.spawned[0]!.harnessConfig).toEqual({
      model: "haiku",
      mode: "bypassPermissions",
      configOptions: { effort: "low" },
    });
  });

  it("sends no harnessConfig when none of them is given", async () => {
    const s = setup();
    await s.spawn({ configOptions: {} });
    expect(s.spawned[0]!.harnessConfig).toBeUndefined();
  });

  it("refuses an empty model before the spawn", async () => {
    const s = setup();
    const result = (await s.spawn({ model: "" })) as {
      content: { text: string }[];
    };
    expect(result.content[0]!.text).toMatch(/refused/);
    expect(s.spawned).toEqual([]);
  });
});
