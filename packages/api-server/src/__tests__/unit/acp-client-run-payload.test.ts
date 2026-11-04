// TEST_OVERVIEW: a channel with no pair of its own starts a session on the agent's channel default, and the internal ACP client is where that payload is built: the default's settings are settled for the run there, so the native subagent keys a channel's sub-agent needs reach the runtime (D193B).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import type { HarnessCapability } from "agent-runtime-api";
import type { SessionPair } from "api-server-api";
import {
  createRunBoundary,
  runSubagentSettings,
} from "../../modules/harness-config/index.js";

const runtime = vi.hoisted(() => ({ port: 0 }));

vi.mock("../../modules/agents/infrastructure/k8s.js", async (original) => ({
  ...(await original<object>()),
  agentServiceAddress: () => `127.0.0.1:${String(runtime.port)}`,
}));

const { createAcpClient } = await import("../../core/acp-client.js");

const closers: (() => void)[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/* UNIT_BOUNDARY_DESCRIPTION: Claude Code's real capability and the owner's listing for the channel default's Connection (D193B). */
const CLAUDE: HarnessCapability = {
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

const inherited: SessionPair = {
  harness: "claude-code",
  provider: "conn-1",
  model: "anthropic/claude-opus-5",
  settings: {
    "platformSubagent.harness": "claude-code",
    "platformSubagent.model": "anthropic/claude-haiku-5",
  },
};

async function client(
  firePair: () => Promise<SessionPair>,
  boundary?: ReturnType<typeof createRunBoundary>,
) {
  const server = createServer();
  const frames: Record<string, unknown>[] = [];
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      const frame = JSON.parse(String(data)) as {
        id?: unknown;
        method?: string;
        params?: unknown;
      };
      frames.push(frame);
      const answer = (result: object) =>
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }));
      if (frame.method === "initialize")
        answer({ protocolVersion: 1, agentCapabilities: {} });
      if (frame.method === "session/new") answer({ sessionId: "s1" });
      if (frame.method === "session/prompt") answer({ stopReason: "end_turn" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => {
    wss.close();
    server.close();
  });
  runtime.port = (server.address() as { port: number }).port;
  const acp = createAcpClient({
    namespace: "ns",
    instanceName: "agent-1",
    stallProbeMs: 60_000,
    firePair,
    ...(boundary ? { runBoundary: boundary } : {}),
  });
  return { acp, frames };
}

describe("a channel's session on its default", () => {
  // TEST_SCENARIO: a channel binding with no pair of its own resolves to the channel default; the internal client sends that default's settings settled for the run, so the sub-agent the default names reaches the runtime as both kinds of subagent (D193B).
  it("starts the session on the default's settled settings", async () => {
    const boundary = createRunBoundary({
      inputsOf: async () => ({
        capabilities: { harnesses: [CLAUDE] },
        catalog,
      }),
    });
    const { acp, frames } = await client(async () => inherited, boundary);
    await acp.sendPrompt("hello", { platformMeta: { type: "channel" } });
    const newSession = frames.find((f) => f.method === "session/new");
    expect(newSession?.params).toMatchObject({
      _meta: {
        platform: {
          follows: "channel",
          harness: "claude-code",
          provider: "conn-1",
          model: "anthropic/claude-opus-5",
          settings: {
            ...inherited.settings,
            subagentModel: "anthropic/claude-haiku-5",
          },
        },
      },
    });
  });
});
