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
 * every spawn runs on the calling session's subagent model when the user
 * set one, a model the catalog does not list for the harness is refused, and
 * a spawn that names none of them sends no harness config at all.
 */

type Handler = (
  args: Record<string, unknown>,
  extra: { signal: AbortSignal },
) => Promise<unknown>;

function setup(
  subagentModel?: () => Promise<string | null>,
  catalogModels?: (
    harness: string,
  ) => Promise<{ alias: string; upstreamId: string; name: string }[] | null>,
  spawningSession?: () => Promise<string | null>,
) {
  const tools = new Map<string, Handler>();
  const server = {
    tool: (name: string, _d: unknown, _shape: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  const spawned: SpawnRequest[] = [];
  const from: unknown[] = [];
  const ops = {
    harness: async () => "claude-code",
    spawn: async (body: SpawnRequest, origin: unknown) => {
      spawned.push(body);
      from.push(origin);
      return { ok: true, id: "agent-child" };
    },
  } as unknown as DriverOps;
  registerSubAgentTools(server, {
    ops,
    awaits: { markAwaited: async () => {}, markCollected: async () => {} },
    ...(subagentModel && { subagentModel }),
    ...(catalogModels && { catalogModels }),
    spawningSession: spawningSession ?? (async () => null),
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
    from,
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

  /** TEST_SCENARIO: The user set a subagent model on the calling session, in
   * Claude Code's own spelling. Every spawn on a named harness runs on it,
   * in the provider-qualified form the spawn route takes, whatever model the
   * spawn names; a spawn on an image alone keeps its own model, since no
   * harness view can check the setting against it; a session with no
   * setting keeps the spawn's own model, and one whose value is no
   * provider-qualified name (a tier word) sends none. */
  it("runs every spawn on the session's subagent model", async () => {
    const set = setup(async () => "claude/ibm/azure/gpt-5.3-codex");
    await set.spawn({});
    expect(set.spawned[0]!.harnessConfig).toEqual({
      model: "ibm/azure/gpt-5.3-codex",
    });
    const result = (await set.spawn({ model: "cb/rits/zai-org/glm-5-3" })) as {
      content: { text: string }[];
    };
    expect(set.spawned[1]!.harnessConfig).toEqual({
      model: "ibm/azure/gpt-5.3-codex",
    });
    expect(result.content[0]!.text).toMatch(/model argument is ignored/);
    await set.spawn({
      harness: undefined,
      image: "ghcr.io/x/y:1",
      model: "cb/rits/zai-org/glm-5-3",
    });
    expect(set.spawned[2]!.harnessConfig).toEqual({
      model: "cb/rits/zai-org/glm-5-3",
    });
    const unset = setup(async () => null);
    await unset.spawn({ model: "cb/rits/zai-org/glm-5-3" });
    expect(unset.spawned[0]!.harnessConfig).toEqual({
      model: "cb/rits/zai-org/glm-5-3",
    });
    const tier = setup(async () => "sonnet");
    await tier.spawn({});
    expect(tier.spawned[0]!.harnessConfig).toBeUndefined();
  });

  /** TEST_SCENARIO: The agent names a model its providers do not list for
   * the target harness (OpenAI's name for an IBM deployment). The spawn is
   * refused naming the listed models, so no sub-agent sits on a refused
   * model until its deadline; a listed one, in either spelling, spawns, and
   * a harness the catalog has no view for is not checked. */
  it("refuses a model the catalog does not list for the harness", async () => {
    const listed = [
      {
        alias: "ibm",
        upstreamId: "azure/gpt-5.3-codex",
        name: "ibm/azure/gpt-5.3-codex",
      },
    ];
    const s = setup(undefined, async (h) => (h === "codex" ? listed : null));
    const refused = (await s.spawn({ model: "openai/gpt-5.3-codex" })) as {
      content: { text: string }[];
    };
    expect(refused.content[0]!.text).toMatch(
      /refused: no granted provider lists openai\/gpt-5.3-codex .*listed: ibm\/azure\/gpt-5.3-codex/,
    );
    expect(s.spawned).toEqual([]);
    await s.spawn({ model: "claude/ibm/azure/GPT-5.3-codex" });
    expect(s.spawned[0]!.harnessConfig).toEqual({
      model: "ibm/azure/GPT-5.3-codex",
    });
    await s.spawn({ harness: "pi", model: "openai/gpt-5.3-codex" });
    expect(s.spawned).toHaveLength(2);
    const bound = setup(
      async () => "claude/anthropic/claude-sonnet-5-5",
      async (h) => (h === "codex" ? listed : null),
    );
    const refusedByBinding = (await bound.spawn({
      model: "ibm/azure/gpt-5.3-codex",
    })) as {
      content: { text: string }[];
    };
    expect(refusedByBinding.content[0]!.text).toMatch(
      /session's subagent model setting \(anthropic\/claude-sonnet-5-5\) binds every sub-agent.*clear the session's subagent model/,
    );
    expect(bound.spawned).toEqual([]);
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

describe("spawn_subagent spawning session", () => {
  // TEST_SCENARIO: the chat shows a running sub-agent only in the Session that spawned it, so a tool spawn records the Session its harness named.
  it("records the session the call came from", async () => {
    const s = setup(undefined, undefined, async () => "session-b");
    await s.spawn({});
    expect(s.from).toEqual([{ origin: "tool", driverSessionId: "session-b" }]);
  });

  // TEST_SCENARIO: a harness that names no Session spawns with none recorded, so the sub-agent shows in every chat of the Driver as before.
  it("records no session when the harness names none", async () => {
    const s = setup();
    await s.spawn({});
    expect(s.from).toEqual([{ origin: "tool", driverSessionId: null }]);
  });
});
