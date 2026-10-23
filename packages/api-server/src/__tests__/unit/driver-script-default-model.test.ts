// TEST_OVERVIEW: a driver script has no Session to take a model from, so a script spawn that names no model runs on the driver's saved default when the default runs on the harness asked for. A spawn that names a model keeps it; a tool spawn, an image spawn, another harness and a driver with no default are refused as before, and a script is told how to name a model rather than to use a session it does not have.
import { describe, expect, test } from "vitest";
import type { SessionPair } from "api-server-api";
import {
  createDriverOps,
  driverDefaultModel,
  type SpawnRequest,
} from "../../apps/harness-api-server/driver-ops.js";
import { NoSpawnModelError } from "../../modules/invocations/index.js";
import type { FirePair } from "../../modules/harness-config/index.js";
import { NoDefaultModelError } from "../../modules/harness-config/domain/no-default-model.js";

const DEFAULT = "ibm/aws/claude-opus-4-8";

function makeOps(
  opts: {
    defaultModel?: (
      driverId: string,
      harness: string,
    ) => Promise<string | null>;
  } = {},
) {
  const spawned: Array<Record<string, unknown>> = [];
  const asked: Array<[string, string]> = [];
  const ops = createDriverOps({
    agents: { get: async () => null },
    scriptOutputs: {} as never,
    invocationsServiceFor: () =>
      ({
        spawn: async (input: Record<string, unknown>) => {
          spawned.push(input);
          if (!(input.harnessConfig as { model?: string } | undefined)?.model)
            throw new NoSpawnModelError();
          return { id: "target-1" };
        },
      }) as never,
    connectionsServiceFor: () =>
      ({
        listConnections: async () => [],
        getAgentConnections: async () => ({ connections: [] }),
      }) as never,
    templates: { list: async () => [], get: async () => null } as never,
    harnesses: {
      default: "claude-code",
      harnesses: [
        { name: "claude-code", displayName: "Claude Code", tags: [] },
        { name: "codex", displayName: "Codex", tags: [] },
      ] as never,
      telemetryEnv: () => [],
    },
    budgetsFor: () => ({}) as never,
    defaultLimits: { cpu: "1", memory: "1Gi" },
    defaultModel:
      opts.defaultModel ??
      (async (driverId, harness) => {
        asked.push([driverId, harness]);
        return harness === "claude-code" ? DEFAULT : null;
      }),
  })({ id: "driver-1", owner: "owner-1" });
  return { ops, spawned, asked };
}

const request = (extra: Partial<SpawnRequest> = {}): SpawnRequest => ({
  prompt: "run one cell",
  schema: { type: "object" },
  harness: "claude-code",
  env: [],
  skills: [],
  ...extra,
});

describe("a driver script's spawn with no model", () => {
  // TEST_SCENARIO: the starter kit's driver script spawns a worker per cell on the driver's own harness and names no model; the worker runs on the default the owner saved, and a mode the script names stays beside it.
  test("runs on the driver's saved default on that default's harness", async () => {
    const { ops, spawned, asked } = makeOps();

    const outcome = await ops.spawn(
      request({ harnessConfig: { mode: "bypassPermissions" } }),
    );

    expect(outcome).toEqual({ ok: true, id: "target-1" });
    expect(asked).toEqual([["driver-1", "claude-code"]]);
    expect(spawned[0]?.harnessConfig).toEqual({
      model: DEFAULT,
      mode: "bypassPermissions",
    });
  });

  test("keeps the model the script names", async () => {
    const { ops, spawned, asked } = makeOps();

    await ops.spawn(
      request({ harnessConfig: { model: "ibm/aws/claude-haiku-4-5" } }),
    );

    expect(asked).toEqual([]);
    expect(spawned[0]?.harnessConfig).toEqual({
      model: "ibm/aws/claude-haiku-4-5",
    });
  });

  // TEST_SCENARIO: the default runs on Claude Code, so a spawn on Codex has nothing its owner chose and is refused, with advice a script can follow: no session to spawn from is mentioned.
  test("on another harness is refused, telling the script how to name one", async () => {
    const { ops } = makeOps();

    const outcome = await ops.spawn(request({ harness: "codex" }));

    expect(outcome).toMatchObject({ ok: false, kind: "invalid" });
    const message = (outcome as { message: string }).message;
    expect(message).toContain("nothing names the sub-agent's model");
    expect(message).toContain("this agent's default model");
    expect(message).not.toContain("session");
  });

  test("from a driver with no default is refused", async () => {
    const { ops } = makeOps({ defaultModel: async () => null });

    const outcome = await ops.spawn(request());

    expect(outcome).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("of an image alone takes no default", async () => {
    const { ops, spawned, asked } = makeOps();

    await ops.spawn(request({ harness: undefined, image: "acme/tool:1" }));

    expect(asked).toEqual([]);
    expect(spawned[0]?.harnessConfig).toBeUndefined();
  });

  // TEST_SCENARIO: a spawn_subagent call resolves its model from its session before it reaches here, so an MCP spawn that still names none keeps the tool's own refusal and is never given the default.
  test("from the spawn_subagent tool takes no default", async () => {
    const { ops, asked } = makeOps();

    const outcome = await ops.spawn(request(), { origin: "tool" });

    expect(asked).toEqual([]);
    expect(outcome).toMatchObject({
      ok: false,
      message: expect.stringContaining("spawn on this session's own harness"),
    });
  });
});

describe("the driver's default model", () => {
  const firePairOf =
    (pair: SessionPair | null | undefined | Error): FirePair =>
    async () => {
      if (pair instanceof Error) throw pair;
      return pair;
    };

  test("is the saved chat default's model on the harness asked for", async () => {
    const asked: unknown[] = [];
    const read = driverDefaultModel(async (...args) => {
      asked.push(args);
      return { harness: "claude-code", provider: "conn-ibm", model: DEFAULT };
    });

    expect(await read("driver-1", "claude-code")).toBe(DEFAULT);
    expect(asked).toEqual([["driver-1", "chat", { harness: "claude-code" }]]);
  });

  test("is none on another harness, with no saved model, a bare name, or on an older runtime", async () => {
    expect(
      await driverDefaultModel(
        firePairOf({
          harness: "claude-code",
          provider: "c",
          model: "claude-opus-4-8",
        }),
      )("driver-1", "claude-code"),
    ).toBeNull();
    expect(
      await driverDefaultModel(
        firePairOf({
          harness: "codex",
          provider: "c",
          model: "openai/gpt-5.5",
        }),
      )("driver-1", "claude-code"),
    ).toBeNull();
    expect(
      await driverDefaultModel(firePairOf(new NoDefaultModelError()))(
        "driver-1",
        "claude-code",
      ),
    ).toBeNull();
    expect(
      await driverDefaultModel(firePairOf(undefined))(
        "driver-1",
        "claude-code",
      ),
    ).toBeNull();
  });

  test("passes on a failed read", async () => {
    await expect(
      driverDefaultModel(firePairOf(new Error("db down")))(
        "driver-1",
        "claude-code",
      ),
    ).rejects.toThrow("db down");
  });
});
