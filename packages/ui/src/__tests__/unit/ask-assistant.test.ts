// @vitest-environment happy-dom
// TEST_OVERVIEW: The assistant's link and the text it leaves behind. A crash notice about one of the person's own Agents gets an action named for the assistant and no timeout, so the keyboard can reach it; with no assistant it keeps its usual timeout and no action. Choosing the link writes the question into the assistant's new chat and sends nothing.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { AgentView } from "../../types.js";

const fake = vi.hoisted(() => ({
  gate: { on: true, known: true },
  state: { data: { agentId: "assistant-1", ready: true } },
  agents: [] as unknown[],
  emitToast: vi.fn(),
  appendNewSessionDraft: vi.fn(),
  selectAgent: vi.fn(),
  leaveChatContext: vi.fn((run: () => void) => run()),
}));

vi.mock("../../brand.js", () => ({
  getBrand: () => ({ assistantName: "Dammy" }),
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      appendNewSessionDraft: fake.appendNewSessionDraft,
      selectAgent: fake.selectAgent,
      leaveChatContext: fake.leaveChatContext,
    }),
}));
vi.mock("../../modules/assistants/api/assistant-state.js", () => ({
  useAssistantGate: () => fake.gate,
  useAssistantState: () => fake.state,
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentsList: () => fake.agents,
}));
vi.mock("../../lib/toast.js", () => ({
  emitToast: fake.emitToast,
}));

const { useAgentCrashToasts } =
  await import("../../modules/agents/hooks/use-agent-crash-toasts.js");
const { useAskAssistant } =
  await import("../../modules/assistants/hooks/use-ask-assistant.js");

const agent = (over: Partial<AgentView> = {}): AgentView =>
  ({
    id: "agent-1",
    name: "Scout",
    state: "running",
    podRestarts: 0,
    access: { role: "owner", editors: [] },
    ...over,
  }) as AgentView;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fake.gate = { on: true, known: true };
  fake.state = { data: { agentId: "assistant-1", ready: true } };
  fake.agents = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function CrashHarness() {
  useAgentCrashToasts();
  return null;
}

function renderCrash(agents: AgentView[]): void {
  fake.agents = agents;
  act(() => root.render(createElement(CrashHarness)));
}

function crash(): void {
  renderCrash([agent()]);
  renderCrash([agent({ podRestarts: 1, podRestartReason: "OutOfMemory" })]);
}

it("offers the assistant on a crash notice with no timeout", () => {
  crash();

  expect(fake.emitToast).toHaveBeenCalledTimes(1);
  const toast = fake.emitToast.mock.calls[0]?.[0] as {
    kind: string;
    message: string;
    ttl?: number;
    action?: { label: string; onClick: () => void };
  };
  expect(toast).toMatchObject({
    kind: "warning",
    message:
      "Scout ran out of memory and restarted — ask an operator to raise its memory budget",
    ttl: 0,
    action: { label: "Ask Dammy" },
  });

  toast.action?.onClick();
  expect(fake.appendNewSessionDraft).toHaveBeenCalledWith(
    "assistant-1",
    expect.stringContaining("Scout crashed at"),
  );
  expect(fake.selectAgent).toHaveBeenCalledWith("assistant-1");
});

it("leaves the notice as it was with no assistant", () => {
  fake.gate = { on: false, known: true };
  crash();

  expect(fake.emitToast).toHaveBeenCalledTimes(1);
  const toast = fake.emitToast.mock.calls[0]?.[0] as {
    ttl?: number;
    action?: unknown;
  };
  expect(toast.ttl).toBeUndefined();
  expect(toast.action).toBeUndefined();
});

it("does not offer to ask the assistant itself", () => {
  fake.state = { data: { agentId: "agent-1", ready: true } };
  crash();

  expect(fake.emitToast).toHaveBeenCalledTimes(1);
  const toast = fake.emitToast.mock.calls[0]?.[0] as { action?: unknown };
  expect(toast.action).toBeUndefined();
});

it("writes the question into a new chat and sends nothing", () => {
  let ask: ((prefill: string) => void) | null = null;
  function AskHarness() {
    ask = useAskAssistant().ask;
    return null;
  }
  act(() => root.render(createElement(AskHarness)));

  act(() => ask?.("why did it fail?"));

  expect(fake.leaveChatContext).toHaveBeenCalledTimes(1);
  expect(fake.appendNewSessionDraft).toHaveBeenCalledWith(
    "assistant-1",
    "why did it fail?",
  );
  expect(fake.selectAgent).toHaveBeenCalledWith("assistant-1");
});
