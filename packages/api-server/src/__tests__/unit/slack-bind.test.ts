import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect, vi } from "vitest";
import type { ConnectSlackResult } from "api-server-api";
import { configureLogger } from "../../core/logger.js";
import {
  executeSlackBind,
  type SlackBindingPort,
} from "../../modules/agents/services/agents-service.js";
import { createSlackBindFlowStore } from "../../modules/channels/infrastructure/slack-flows.js";

configureLogger({ level: "error", write: () => {} });

const OWNER = "kc|owner-1";

async function harness(opts?: {
  owner?: string;
  boundTo?: string | null;
  boundIn?: string;
  connectOk?: boolean;
  connectError?: ConnectSlackResult & { ok: false };
  postError?: string;
}) {
  const store = createSlackBindFlowStore({
    now: () => 1_000,
    store: createMemoryTtlStore(600_000, () => 1_000),
  });
  const flowId = await store.create({
    slackChannelId: "C-1",
    teamId: "T-HERE",
    slackUserId: "U-7",
    keycloakSub: OWNER,
    channelTitle: "general",
  });

  const binding: SlackBindingPort = {
    peekFlow: store.peek,
    consumeFlow: store.consume,
    postMessage: vi.fn(async () =>
      opts?.postError ? { error: opts.postError } : { ok: true as const },
    ),
  };
  const findChannelBindings = vi.fn(async () =>
    opts?.boundTo
      ? [{ agentId: opts.boundTo, teamId: opts.boundIn ?? "T-HERE" }]
      : [],
  );
  const connectShared = vi.fn(async (): Promise<ConnectSlackResult> => {
    if (opts?.connectError) return opts.connectError;
    return opts?.connectOk === false
      ? { ok: false, error: { type: "ChannelAlreadyBound" } }
      : { ok: true, value: { id: "agent-1" } as never };
  });

  const run = executeSlackBind({
    owner: opts?.owner === undefined ? OWNER : opts.owner,
    getAgent: async (id) =>
      id === "agent-1" ? { id: "agent-1", name: "my-agent" } : null,
    findChannelBindings,
    connectShared,
    binding,
  });

  return { run, store, flowId, binding, findChannelBindings, connectShared };
}

describe("slack bind flow", () => {
  it("binds shared (ambient off), consumes the flow, posts a plain confirmation, returns the title", async () => {
    const h = await harness();
    const res = await h.run("agent-1", h.flowId);
    expect(res).toEqual({
      ok: true,
      value: { slackChannelId: "C-1", channelTitle: "general" },
    });
    expect(h.connectShared).toHaveBeenCalledWith("agent-1", "C-1", "T-HERE");
    expect(await h.store.peek(h.flowId)).toBe(null);
    const [, , text] = vi.mocked(h.binding.postMessage).mock.calls[0]!;
    expect(text).toContain("my-agent");
    expect(text).not.toContain("without being mentioned");
  });

  it("rejects an unknown flow id", async () => {
    const h = await harness();
    expect(await h.run("agent-1", "no-such-flow")).toEqual({
      ok: false,
      error: { type: "FlowInvalid" },
    });
  });

  it("rejects a different signed-in user WITHOUT consuming the flow", async () => {
    const h = await harness({ owner: "kc|someone-else" });
    expect(await h.run("agent-1", h.flowId)).toEqual({
      ok: false,
      error: { type: "FlowInvalid" },
    });
    expect(await h.store.peek(h.flowId)).not.toBe(null);
    expect(h.connectShared).not.toHaveBeenCalled();
  });

  it("rejects an agent the caller does not own", async () => {
    const h = await harness();
    expect(await h.run("agent-of-someone-else", h.flowId)).toEqual({
      ok: false,
      error: { type: "AgentNotFound" },
    });
  });

  /**
   * TEST_SCENARIO: a channel may hold several agents, so joining one that
   * another agent already serves succeeds instead of being refused.
   */
  it("connects alongside an agent already in the channel", async () => {
    const h = await harness({ boundTo: "agent-2" });
    expect(await h.run("agent-1", h.flowId)).toEqual({
      ok: true,
      value: { slackChannelId: "C-1", channelTitle: "general" },
    });
    expect(h.connectShared).toHaveBeenCalledWith("agent-1", "C-1", "T-HERE");
    const [, , text] = vi.mocked(h.binding.postMessage).mock.calls[0]!;
    expect(text).toContain("alongside one agent");
    expect(text).toContain("Start a mention with an agent's name");
  });

  /**
   * TEST_SCENARIO: the same agent twice in one conversation is still refused —
   * that is what the remaining uniqueness rule protects.
   */
  it("refuses re-binding the SAME agent, keeping the flow alive", async () => {
    const h = await harness({ boundTo: "agent-1" });
    expect(await h.run("agent-1", h.flowId)).toEqual({
      ok: false,
      error: { type: "ChannelAlreadyBound" },
    });
    expect(h.connectShared).not.toHaveBeenCalled();
    expect(await h.store.peek(h.flowId)).not.toBe(null);
  });

  /**
   * TEST_SCENARIO: the existing binding names the conversation's workspace by
   * a different name than the flow does — the original workspace has two, and
   * a shared channel is one conversation however many workspaces see it — so
   * the guard must ignore the name. Comparing names here reads one workspace
   * as two: the guard goes dead, and the "successful" re-bind rewrites the
   * existing row, silently dropping its ambient flag.
   */
  it("refuses a re-bind whatever name the existing binding knows the workspace by", async () => {
    const h = await harness({ boundTo: "agent-1", boundIn: "" });
    expect(await h.run("agent-1", h.flowId)).toEqual({
      ok: false,
      error: { type: "ChannelAlreadyBound" },
    });
    expect(h.connectShared).not.toHaveBeenCalled();
  });

  it("maps a lost connect race to ChannelAlreadyBound", async () => {
    const h = await harness({ connectOk: false });
    expect(await h.run("agent-1", h.flowId)).toEqual({
      ok: false,
      error: { type: "ChannelAlreadyBound" },
    });
  });

  /**
   * TEST_SCENARIO: a connect that failed for a reason of its own. Every
   * failure used to be reported as ChannelAlreadyBound, so a workspace that
   * could not be worked out told the operator their agent was already
   * connected — a statement about a binding that did not exist, and one that
   * sends them looking in the wrong place. Unresolved and unreachable stay
   * apart too: reading them the same way tells an operator to distrust a
   * conversation that was right all along.
   */
  it("reports why a connect failed rather than calling everything a re-bind", async () => {
    const unresolved = await harness({
      connectError: { ok: false, error: { type: "WorkspaceUnresolved" } },
    });
    expect(await unresolved.run("agent-1", unresolved.flowId)).toEqual({
      ok: false,
      error: { type: "WorkspaceUnresolved" },
    });

    const unreachable = await harness({
      connectError: { ok: false, error: { type: "WorkspaceUnreachable" } },
    });
    expect(await unreachable.run("agent-1", unreachable.flowId)).toEqual({
      ok: false,
      error: { type: "WorkspaceUnreachable" },
    });

    const missing = await harness({
      connectError: { ok: false, error: { type: "AgentNotFound" } },
    });
    expect(await missing.run("agent-1", missing.flowId)).toEqual({
      ok: false,
      error: { type: "AgentNotFound" },
    });
  });

  it("still succeeds when the in-chat confirmation fails", async () => {
    const h = await harness({ postError: "bot not running" });
    expect(await h.run("agent-1", h.flowId)).toEqual({
      ok: true,
      value: { slackChannelId: "C-1", channelTitle: "general" },
    });
  });
});
