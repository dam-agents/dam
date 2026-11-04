// TEST_OVERVIEW: a client that starts a session through the ACP relay without naming a model, such as `dam run`, gets the agent's saved default Session Pair filled into its `session/new`, as the web chat sends it. A frame that names a model, an agent with no saved default and every other frame reach the runtime as the client sent them, and in the order it sent them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { SessionPair } from "api-server-api";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { ApprovalsRelayService } from "../../modules/approvals/compose.js";
import type { SessionPresence } from "../../apps/api-server/agent-proxies/session-presence.js";
import type {
  FirePair,
  RunBoundary,
} from "../../modules/harness-config/index.js";
import {
  createRunBoundary,
  runSubagentSettings,
} from "../../modules/harness-config/index.js";
import type { HarnessCapability } from "agent-runtime-api";
import { NoDefaultModelError } from "../../modules/harness-config/domain/no-default-model.js";

const runtime = vi.hoisted(() => ({ port: 0 }));

vi.mock("../../modules/agents/infrastructure/k8s.js", async (original) => ({
  ...(await original<object>()),
  agentServiceAddress: () => `127.0.0.1:${String(runtime.port)}`,
}));

const { createAcpRelay } =
  await import("../../apps/api-server/agent-proxies/acp-relay.js");
const { fillSavedDefault } =
  await import("../../apps/api-server/agent-proxies/saved-default.js");

const saved: SessionPair = {
  harness: "claude-code",
  provider: "conn-1",
  model: "anthropic/claude-opus-5-5",
};

const repo = {
  resolveIdentity: async (agentId: string) => ({ owner: "u", agentId }),
  ensureReady: async () => {},
  peekCached: () => null,
  patchAnnotation: async () => {},
} as unknown as AgentsRepository;

const approvals = {
  subscribeFrameInjects: () => () => {},
} as unknown as ApprovalsRelayService;

const presence = { acquire: () => () => {} } as unknown as SessionPresence;

const closers: (() => void)[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => server.close());
  return (server.address() as { port: number }).port;
}

async function world(firePair: FirePair, boundary?: RunBoundary) {
  const upstream = createServer();
  const received: Record<string, unknown>[] = [];
  const upstreamWss = new WebSocketServer({ server: upstream });
  upstreamWss.on("connection", (ws) => {
    ws.on("message", (data) => {
      received.push(JSON.parse(String(data)) as Record<string, unknown>);
    });
  });
  closers.push(() => upstreamWss.close());
  runtime.port = await listen(upstream);

  const relay = createAcpRelay(
    "ns",
    repo,
    approvals,
    presence,
    firePair,
    boundary,
  );
  const front = createServer();
  front.on("upgrade", (req, socket, head) => {
    relay.handleUpgrade(req, socket, head, "agent-1", {
      sub: "u",
      surface: "cli",
      attached: () => {},
      editor: null,
      email: null,
      opened: () => {},
    });
  });
  const port = await listen(front);
  const client = new WebSocket(`ws://127.0.0.1:${String(port)}/`);
  closers.push(() => client.terminate());
  await new Promise<void>((res, rej) => {
    client.once("open", res);
    client.once("error", rej);
  });
  return {
    send: (frame: object) => client.send(JSON.stringify(frame)),
    received: async (count: number) => {
      await vi.waitFor(() => expect(received).toHaveLength(count));
      return received;
    },
  };
}

const cliNewSession = {
  jsonrpc: "2.0",
  id: 2,
  method: "session/new",
  params: {
    cwd: ".",
    mcpServers: [],
    _meta: { platform: { mode: "chat", type: "cli_run" } },
  },
};

describe("ACP relay: the saved default on a new session", () => {
  // TEST_SCENARIO: `dam run` sends `session/new` with no harness or model; the runtime must receive the agent's saved default, or it refuses the session as having no model.
  it("fills the saved default into a session/new that names no model", async () => {
    const firePair = vi.fn<FirePair>(async () => saved);
    const relay = await world(firePair);
    relay.send(cliNewSession);
    const [frame] = await relay.received(1);
    expect(frame?.params).toEqual({
      cwd: ".",
      mcpServers: [],
      _meta: {
        platform: {
          follows: "chat",
          mode: "chat",
          type: "cli_run",
          harness: "claude-code",
          provider: "conn-1",
          model: "anthropic/claude-opus-5-5",
        },
      },
    });
    expect(firePair).toHaveBeenCalledWith("agent-1", "chat", {});
  });

  // TEST_SCENARIO: frames sent while the saved default is looked up must not overtake the `session/new` before them, or a prompt would reach the runtime before its session exists.
  it("keeps the client's frame order while it looks the default up", async () => {
    let answer!: (pair: SessionPair) => void;
    const relay = await world(
      () => new Promise<SessionPair>((r) => (answer = r)),
    );
    relay.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    relay.send(cliNewSession);
    relay.send({ jsonrpc: "2.0", method: "session/cancel", params: {} });
    await vi.waitFor(() => expect(answer).toBeDefined());
    answer(saved);
    const frames = await relay.received(3);
    expect(frames.map((f) => f.method)).toEqual([
      "initialize",
      "session/new",
      "session/cancel",
    ]);
  });

  // TEST_SCENARIO: an agent with no saved default model gets the frame as sent, so the runtime's own no-model refusal names the Providers page.
  it("passes the frame on when the agent has no default model", async () => {
    const relay = await world(async () => {
      throw new NoDefaultModelError();
    });
    relay.send(cliNewSession);
    const [frame] = await relay.received(1);
    expect(frame).toEqual(cliNewSession);
  });

  // TEST_SCENARIO: a failing lookup must not swallow the session/new; it goes on as sent.
  it("passes the frame on when the lookup fails", async () => {
    const relay = await world(async () => {
      throw new Error("db down");
    });
    relay.send(cliNewSession);
    const [frame] = await relay.received(1);
    expect(frame).toEqual(cliNewSession);
  });
  // TEST_SCENARIO: a second session/new whose lookup fails while the first one's is still running must not leave a rejection unhandled, which would stop the api-server; both frames still reach the runtime in order.
  it("survives a queued lookup that fails before the one ahead of it", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    closers.push(() => process.off("unhandledRejection", unhandled));
    let answerFirst!: (pair: SessionPair) => void;
    const firePair = vi
      .fn<FirePair>()
      .mockImplementationOnce(
        () => new Promise<SessionPair>((r) => (answerFirst = r)),
      )
      .mockImplementationOnce(async () => {
        throw new Error("db down");
      });
    const relay = await world(firePair);
    relay.send(cliNewSession);
    relay.send({ ...cliNewSession, id: 3 });
    await vi.waitFor(() => expect(firePair).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    answerFirst(saved);
    const frames = await relay.received(2);
    expect(frames.map((f) => f.id)).toEqual([2, 3]);
    expect(frames[1]).toEqual({ ...cliNewSession, id: 3 });
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("fillSavedDefault", () => {
  const firePair = vi.fn<FirePair>(async () => saved);

  // TEST_SCENARIO: a session/new that already names a model is the client's choice, and no lookup runs.
  it("leaves a session/new that names a model alone", () => {
    const frame = {
      ...cliNewSession,
      params: { _meta: { platform: { model: "openai/gpt-5" } } },
    };
    expect(fillSavedDefault(frame, "agent-1", firePair)).toBeNull();
    expect(firePair).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: only session/new is filled or settled; a prompt, a load and a running session's settings change keep the session's own model, since only the client holds that session's whole state (D193B).
  it("leaves every other frame alone", () => {
    for (const method of [
      "session/prompt",
      "session/load",
      "initialize",
      "_platform/session/configure",
    ])
      expect(
        fillSavedDefault({ jsonrpc: "2.0", id: 1, method }, "a", firePair),
      ).toBeNull();
    expect(firePair).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a client that names a harness gets the saved default for that harness, with the client's own settings kept over the saved ones.
  it("looks up the default for the harness the client names", async () => {
    const pick = vi.fn<FirePair>(async () => ({
      harness: "codex",
      provider: "conn-2",
      model: "openai/gpt-5",
      settings: { mode: "auto" },
    }));
    const frame = {
      jsonrpc: "2.0",
      id: 3,
      method: "session/new",
      params: {
        _meta: { platform: { harness: "codex", settings: { mode: "plan" } } },
      },
    };
    await expect(fillSavedDefault(frame, "agent-1", pick)).resolves.toEqual({
      ...frame,
      params: {
        _meta: {
          platform: {
            harness: "codex",
            provider: "conn-2",
            model: "openai/gpt-5",
            settings: { mode: "plan" },
          },
        },
      },
    });
    expect(pick).toHaveBeenCalledWith("agent-1", "chat", { harness: "codex" });
  });

  // TEST_SCENARIO: a runtime that does not route Session Pairs, or a saved default with no model, leaves nothing to fill.
  it("fills nothing when the resolved pair has no model", async () => {
    const none = vi.fn<FirePair>(async () => undefined);
    await expect(
      fillSavedDefault(cliNewSession, "agent-1", none),
    ).resolves.toBeNull();
    const noModel = vi.fn<FirePair>(async () => ({ ...saved, model: null }));
    await expect(
      fillSavedDefault(cliNewSession, "agent-1", noModel),
    ).resolves.toBeNull();
  });
});

describe("ACP relay: a running session's settings change", () => {
  // TEST_SCENARIO: the client holds the whole state of a session it runs, so a configure frame goes to the runtime exactly as it was sent, platform-level settings and all; the api-server settles only the frames that start or drive a run it builds itself (D193B).
  it("passes a configure frame on untouched", async () => {
    const boundary = createRunBoundary({
      inputsOf: async () => ({ capabilities: null, catalog: null }),
    });
    const relay = await world(async () => saved, boundary);
    const frame = {
      jsonrpc: "2.0",
      id: 21,
      method: "_platform/session/configure",
      params: {
        sessionId: "s1",
        settings: {
          "platformSubagent.harness": "claude-code",
          "platformSubagent.model": "anthropic/claude-haiku-5",
        },
      },
    };
    relay.send(frame);
    const [sent] = await relay.received(1);
    expect(sent).toEqual(frame);
  });
});

describe("ACP relay: the native subagent settings on a new session", () => {
  /* UNIT_BOUNDARY_DESCRIPTION: Claude Code's real capability and the owner's listing for the primary's Connection, which is what says the sub-agent's model runs there (D193B). */
  const CLAUDE: HarnessCapability = {
    name: "claude-code",
    harnessConfig: true,
    sessionModel: true,
    sessionSettings: ["subagentModel", "subagentEffort"],
    harnessConfigCatalog: {
      options: [
        {
          id: "subagentModel",
          name: "Subagent model",
          category: "model",
          subagents: true,
          choices: [],
        },
        {
          id: "subagentEffort",
          name: "Subagent effort",
          category: "thought_level",
          subagents: true,
          choices: [{ value: "high", name: "High" }],
        },
      ],
    },
  };
  const catalog = {
    providers: [
      {
        connectionId: "conn-1",
        models: [
          { name: "anthropic/claude-haiku-5", harnesses: ["claude-code"] },
        ],
      },
    ],
  } as unknown as Parameters<typeof runSubagentSettings>[1];

  const boundary = (resolvePair?: RunBoundary["resolve"]): RunBoundary =>
    createRunBoundary({
      inputsOf: async () => ({
        capabilities: { harnesses: [CLAUDE] },
        catalog,
      }),
      ...(resolvePair
        ? {
            resolvePair: async (agentId, kind, wanted) => {
              void kind;
              return resolvePair(agentId, "chat", wanted);
            },
          }
        : {}),
    });

  // TEST_SCENARIO: a `session/new` that names its model but carries a platform sub-agent goes out with the harness's own subagents' model and effort derived from the owner catalog, which is what a run starts on; the agent's own stored listing is not the authority and is never read here (D193B).
  it("derives the subagent's native settings into the frame it sends", async () => {
    const relay = await world(async () => saved, boundary());
    relay.send({
      jsonrpc: "2.0",
      id: 3,
      method: "session/new",
      params: {
        cwd: ".",
        mcpServers: [],
        _meta: {
          platform: {
            mode: "chat",
            type: "cli_run",
            harness: "claude-code",
            provider: "conn-1",
            model: "anthropic/claude-opus-5-5",
            settings: {
              "platformSubagent.harness": "claude-code",
              "platformSubagent.model": "anthropic/claude-haiku-5",
              "platformSubagent.effort": "high",
            },
          },
        },
      },
    });
    const [frame] = await relay.received(1);
    expect(frame?.params).toMatchObject({
      _meta: {
        platform: {
          model: "anthropic/claude-opus-5-5",
          settings: {
            "platformSubagent.harness": "claude-code",
            "platformSubagent.model": "anthropic/claude-haiku-5",
            "platformSubagent.effort": "high",
            subagentModel: "anthropic/claude-haiku-5",
            subagentEffort: "high",
          },
        },
      },
    });
  });

  // TEST_SCENARIO: a sub-agent model the primary's Connection does not list keeps the platform slot alone, so the harness's own subagents pick rather than being handed a model the harness would refuse (D193B).
  it("leaves the native settings off a sub-agent its Connection does not list", async () => {
    const relay = await world(async () => saved, boundary());
    relay.send({
      jsonrpc: "2.0",
      id: 4,
      method: "session/new",
      params: {
        cwd: ".",
        mcpServers: [],
        _meta: {
          platform: {
            mode: "chat",
            type: "cli_run",
            harness: "claude-code",
            provider: "conn-1",
            model: "anthropic/claude-opus-5-5",
            settings: {
              "platformSubagent.harness": "claude-code",
              "platformSubagent.model": "openai/gpt-6.1-sol",
            },
          },
        },
      },
    });
    const [frame] = await relay.received(1);
    expect(frame?.params).toMatchObject({
      _meta: {
        platform: {
          settings: {
            "platformSubagent.harness": "claude-code",
            "platformSubagent.model": "openai/gpt-6.1-sol",
          },
        },
      },
    });
  });
});

describe("ACP relay: a session/new naming its model but not its harness or provider", () => {
  /* UNIT_BOUNDARY_DESCRIPTION: Claude Code's capability and the owner's listing, as the run boundary needs them (D193B). */
  const CLAUDE = {
    name: "claude-code",
    harnessConfig: true,
    sessionModel: true,
    sessionSettings: ["subagentModel"],
    harnessConfigCatalog: {
      options: [
        {
          id: "subagentModel",
          name: "Subagent model",
          category: "model",
          subagents: true,
          choices: [],
        },
      ],
    },
  } as never;
  const catalog = {
    providers: [
      {
        connectionId: "conn-1",
        models: [
          { name: "anthropic/claude-haiku-5", harnesses: ["claude-code"] },
        ],
      },
    ],
  } as unknown as Parameters<typeof runSubagentSettings>[1];
  const resolved: SessionPair = {
    harness: "claude-code",
    provider: "conn-1",
    model: "anthropic/claude-opus-5-5",
  };

  function boundary(): RunBoundary {
    return createRunBoundary({
      inputsOf: async () => ({
        capabilities: { harnesses: [CLAUDE] },
        catalog,
      }),
      resolvePair: async () => resolved,
    });
  }

  const frame = (platform: Record<string, unknown>) => ({
    jsonrpc: "2.0",
    id: 7,
    method: "session/new",
    params: { cwd: ".", mcpServers: [], _meta: { platform } },
  });
  const slot = {
    "platformSubagent.harness": "claude-code",
    "platformSubagent.model": "anthropic/claude-haiku-5",
  };

  // TEST_SCENARIO: a frame that names its model and sub-agent but omits its harness, and one that omits its provider too, go out exactly as the fully specified frame does: the effective primary is resolved the way every other run boundary resolves it, then the settings are derived (D193B).
  it("resolves the missing harness and provider before deriving", async () => {
    const relay = await world(async () => saved, boundary());
    relay.send(
      frame({
        mode: "chat",
        type: "cli_run",
        model: "anthropic/claude-opus-5-5",
        provider: "conn-1",
        harness: "claude-code",
        settings: slot,
      }),
    );
    relay.send(
      frame({
        mode: "chat",
        type: "cli_run",
        model: "anthropic/claude-opus-5-5",
        provider: "conn-1",
        settings: slot,
      }),
    );
    relay.send(
      frame({
        mode: "chat",
        type: "cli_run",
        model: "anthropic/claude-opus-5-5",
        settings: slot,
      }),
    );
    const [full, noHarness, noProvider] = await relay.received(3);
    const platform = (of: Record<string, unknown> | undefined) =>
      (of?.params as { _meta: { platform: Record<string, unknown> } })._meta
        .platform;
    expect(platform(noHarness)).toEqual(platform(full));
    expect(platform(noProvider)).toEqual(platform(full));
    expect(platform(full).settings).toEqual({
      ...slot,
      subagentModel: "anthropic/claude-haiku-5",
    });
  });
});
