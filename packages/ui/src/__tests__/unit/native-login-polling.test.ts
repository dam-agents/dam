// @vitest-environment happy-dom
// TEST_OVERVIEW: Device authorization polls quickly only while its terminal runs, then returns to the normal interval; retry starts a new polling lifetime.
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { NativeLoginCard } from "../../modules/providers/components/native-login-card.js";

const fake = vi.hoisted(() => ({
  probe: vi.fn(),
  exit: (_code: number) => {},
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useIsAgentOperable: () => true,
  useAgentLacksLiveUpdates: () => false,
}));
vi.mock("../../modules/agents/agent-trpc.js", () => ({
  agentTrpc: () => ({ nativeLogin: { status: { query: () => fake.probe() } } }),
  agentTrpcHttp: () => ({
    nativeLogin: { status: { query: () => fake.probe() } },
  }),
}));
vi.mock("../../modules/sessions/components/terminal.js", () => ({
  Terminal: ({ onExit }: { onExit: (code: number) => void }) => {
    fake.exit = onExit;
    return null;
  },
}));
let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
  vi.clearAllMocks();
});

// TEST_SCENARIO: An exited device terminal must not keep launching Codex status processes every two seconds. A retry resumes fast checks, and the expired terminal's late exit cannot stop its replacement.
it("stops fast polling at terminal exit and gives a retry its own lifetime", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  focusManager.setFocused(true);
  fake.probe.mockResolvedValue({
    state: "sign-in-required",
    checkedAt: "2026-11-11T00:00:00Z",
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup = () => {
    act(() => root.unmount());
    client.clear();
    container.remove();
  };
  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          TooltipProvider,
          null,
          createElement(NativeLoginCard, {
            agentId: "agent-1",
            maySignIn: true,
          }),
        ),
      ),
    ),
  );
  await tick(0);
  const button = (text: string) =>
    Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === text,
    )!;
  await act(async () => button("Sign in to ChatGPT").click());
  const beforeActive = fake.probe.mock.calls.length;
  await tick(2100);
  expect(fake.probe.mock.calls.length).toBeGreaterThan(beforeActive);
  const oldExit = fake.exit;
  await act(async () => oldExit(1));
  await tick(0);
  const afterExit = fake.probe.mock.calls.length;
  await tick(6000);
  expect(fake.probe.mock.calls.length).toBe(afterExit);
  await act(async () => button("Get a new code").click());
  await act(async () => oldExit(0));
  await tick(0);
  const afterRetry = fake.probe.mock.calls.length;
  await tick(2100);
  expect(fake.probe.mock.calls.length).toBeGreaterThan(afterRetry);
  await act(async () => fake.exit(0));
  await tick(0);
  const afterSuccess = fake.probe.mock.calls.length;
  await tick(6000);
  expect(fake.probe.mock.calls.length).toBe(afterSuccess);
});
