import { describe, it, expect, vi } from "vitest";
import { configureLogger } from "../../core/logger.js";
import {
  executeTelegramBind,
  type TelegramBindingPort,
} from "../../modules/agents/services/agents-service.js";
import {
  createTelegramBindFlowStore,
  type TelegramBindFlowStore,
} from "../../modules/channels/infrastructure/telegram-flows.js";

// Swallow securityLog output from the deny/notify paths under test.
configureLogger({ level: "error", write: () => {} });

const OWNER = "kc|owner-1";

function harness(opts?: {
  owner?: string;
  boundTo?: string | null;
  bindOutcome?: "bound" | "conflict";
  racedTo?: string | null;
  postError?: string;
}) {
  const store: TelegramBindFlowStore = createTelegramBindFlowStore({
    now: () => 1_000,
  });
  const flowId = store.create({
    conversationId: "chat-42",
    telegramUserId: "tg-7",
    keycloakSub: OWNER,
    chatTitle: "Team chat",
  });

  let bound = false;
  const binding: TelegramBindingPort = {
    peekFlow: store.peek,
    consumeFlow: store.consume,
    findAgentByConversation: vi.fn(async () => {
      if (bound && opts?.bindOutcome === "conflict") {
        // post-race re-read
        return opts.racedTo
          ? { agentId: opts.racedTo, authorizedBy: "x" }
          : null;
      }
      return opts?.boundTo
        ? { agentId: opts.boundTo, authorizedBy: "x" }
        : null;
    }),
    bind: vi.fn(async () => {
      bound = true;
      return opts?.bindOutcome ?? "bound";
    }),
    postMessage: vi.fn(async () =>
      opts?.postError ? { error: opts.postError } : { ok: true as const },
    ),
    botUsername: () => "dam_test_bot",
    mintConnectCode: vi.fn(() => "code-1"),
  };

  const run = executeTelegramBind({
    owner: opts?.owner === undefined ? OWNER : opts.owner,
    getAgent: async (id) =>
      id === "agent-1" ? { id: "agent-1", name: "my-agent" } : null,
    binding,
  });

  return { run, store, flowId, binding };
}

describe("telegram bind flow", () => {
  it("binds, consumes the flow, posts confirmation, returns the chat title", async () => {
    const h = harness();
    const res = await h.run("agent-1", h.flowId);
    expect(res).toEqual({ ok: true, value: { chatTitle: "Team chat" } });
    expect(h.binding.bind).toHaveBeenCalledWith("chat-42", "agent-1", OWNER);
    expect(h.store.peek(h.flowId)).toBe(null);
    expect(h.binding.postMessage).toHaveBeenCalledWith(
      "agent-1",
      "chat-42",
      expect.stringContaining("my-agent"),
    );
  });

  it("rejects an unknown flow id", async () => {
    const h = harness();
    const res = await h.run("agent-1", "no-such-flow");
    expect(res).toEqual({ ok: false, error: { type: "FlowInvalid" } });
  });

  it("rejects a different signed-in user WITHOUT consuming the flow", async () => {
    const h = harness({ owner: "kc|someone-else" });
    const res = await h.run("agent-1", h.flowId);
    expect(res).toEqual({ ok: false, error: { type: "FlowInvalid" } });
    expect(h.store.peek(h.flowId)).not.toBe(null);
    expect(h.binding.bind).not.toHaveBeenCalled();
  });

  it("rejects an agent the caller does not own", async () => {
    const h = harness();
    const res = await h.run("agent-of-someone-else", h.flowId);
    expect(res).toEqual({ ok: false, error: { type: "AgentNotFound" } });
  });

  it("CONFLICTs when the chat is bound to another agent, keeping the flow alive", async () => {
    const h = harness({ boundTo: "agent-2" });
    const res = await h.run("agent-1", h.flowId);
    expect(res).toEqual({ ok: false, error: { type: "ChatAlreadyBound" } });
    expect(h.store.peek(h.flowId)).not.toBe(null);
  });

  it("is idempotent when the chat is already bound to the same agent", async () => {
    const h = harness({ boundTo: "agent-1" });
    const res = await h.run("agent-1", h.flowId);
    expect(res).toEqual({ ok: true, value: { chatTitle: "Team chat" } });
    expect(h.binding.bind).not.toHaveBeenCalled();
    expect(h.store.peek(h.flowId)).toBe(null);
  });

  it("resolves a lost insert race by re-reading the binding", async () => {
    const won = harness({ bindOutcome: "conflict", racedTo: "agent-1" });
    expect(await won.run("agent-1", won.flowId)).toEqual({
      ok: true,
      value: { chatTitle: "Team chat" },
    });

    const lost = harness({ bindOutcome: "conflict", racedTo: "agent-9" });
    expect(await lost.run("agent-1", lost.flowId)).toEqual({
      ok: false,
      error: { type: "ChatAlreadyBound" },
    });
  });

  it("still succeeds when the in-chat confirmation fails", async () => {
    const h = harness({ postError: "bot not running" });
    const res = await h.run("agent-1", h.flowId);
    expect(res).toEqual({ ok: true, value: { chatTitle: "Team chat" } });
  });
});
