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
  connectOk?: boolean;
  postError?: string;
}) {
  const store = createSlackBindFlowStore({
    now: () => 1_000,
    store: createMemoryTtlStore(600_000, () => 1_000),
  });
  const flowId = await store.create({
    slackChannelId: "C-1",
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
  const findChannelBinding = vi.fn(async () =>
    opts?.boundTo ? { agentId: opts.boundTo } : null,
  );
  const connectShared = vi.fn(
    async (): Promise<ConnectSlackResult> =>
      opts?.connectOk === false
        ? { ok: false, error: { type: "ChannelAlreadyBound" } }
        : { ok: true, value: { id: "agent-1" } as never },
  );

  const run = executeSlackBind({
    owner: opts?.owner === undefined ? OWNER : opts.owner,
    getAgent: async (id) =>
      id === "agent-1" ? { id: "agent-1", name: "my-agent" } : null,
    findChannelBinding,
    connectShared,
    binding,
  });

  return { run, store, flowId, binding, findChannelBinding, connectShared };
}

describe("slack bind flow", () => {
  it("binds shared (ambient off), consumes the flow, posts a plain confirmation, returns the title", async () => {
    const h = await harness();
    const res = await h.run("agent-1", h.flowId);
    expect(res).toEqual({ ok: true, value: { channelTitle: "general" } });
    expect(h.connectShared).toHaveBeenCalledWith("agent-1", "C-1");
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

  it("rejects an already-bound channel outright, keeping the flow alive", async () => {
    const h = await harness({ boundTo: "agent-2" });
    expect(await h.run("agent-1", h.flowId)).toEqual({
      ok: false,
      error: { type: "ChannelAlreadyBound" },
    });
    expect(h.connectShared).not.toHaveBeenCalled();
    expect(await h.store.peek(h.flowId)).not.toBe(null);
  });

  it("also refuses re-binding the SAME agent (no in-place override)", async () => {
    const h = await harness({ boundTo: "agent-1" });
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

  it("still succeeds when the in-chat confirmation fails", async () => {
    const h = await harness({ postError: "bot not running" });
    expect(await h.run("agent-1", h.flowId)).toEqual({
      ok: true,
      value: { channelTitle: "general" },
    });
  });
});
