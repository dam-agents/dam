// @vitest-environment happy-dom
// TEST_OVERVIEW: Each agent's provider card distinguishes recognized sign-in, missing sign-in and an unavailable check. An asleep agent or a failed refresh never keeps a stale signed-in label.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { NativeLoginCard } from "../../modules/providers/components/native-login-card.js";

const fake = vi.hoisted(() => ({
  refetch: vi.fn(),
  exit: (code: number) => {
    void code;
  },
  status: {
    operable: true,
    isError: false,
    isPending: false,
    isFetching: false,
    data: { state: "signed-in" },
  },
}));
vi.mock("../../modules/agents/api/native-login.js", () => ({
  useNativeLoginStatus: () => ({ ...fake.status, refetch: fake.refetch }),
}));
vi.mock("../../modules/sessions/components/terminal.js", () => ({
  Terminal: ({
    nativeLogin,
    onExit,
    sessionId,
  }: {
    nativeLogin?: boolean;
    onExit?: (code: number) => void;
    sessionId?: string;
  }) => {
    if (onExit) fake.exit = onExit;
    return createElement("div", {
      "data-native-login": String(nativeLogin),
      "data-session-id": sessionId,
    });
  },
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("per-agent native sign-in status", () => {
  it.each([
    [{ state: "signed-in" }, true, false, false, "Signed in on this agent"],
    [
      { state: "sign-in-required" },
      true,
      false,
      false,
      "ChatGPT sign-in required",
    ],
    [{ state: "unavailable" }, true, false, false, "Could not check sign-in"],
    [{ state: "signed-in" }, true, true, false, "Could not check sign-in"],
    [{ state: "signed-in" }, false, false, false, "Agent asleep"],
    [{ state: "signed-in" }, true, false, true, "Checking ChatGPT sign-in"],
  ])(
    "shows the current check without stale success",
    (data, operable, isError, isPending, expected) => {
      fake.status = { data, operable, isError, isPending, isFetching: false };
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      cleanup = () => {
        act(() => root.unmount());
        container.remove();
      };
      act(() =>
        root.render(
          createElement(
            TooltipProvider,
            null,
            createElement(NativeLoginCard, {
              agentId: "agent-1",
              maySignIn: false,
            }),
          ),
        ),
      );
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        expected,
      );
      if (expected !== "Signed in on this agent")
        expect(container.textContent).not.toContain("Signed in on this agent");
      const button =
        Array.from(container.querySelectorAll("button")).find(
          (b) => b.textContent === "Check again",
        ) ?? null;
      if (!operable) expect(button).toBeNull();
      else {
        act(() => button?.click());
        expect(fake.refetch).toHaveBeenCalledOnce();
      }
    },
  );
});

// TEST_SCENARIO: Only the owner starts device authorization, through a deliberate button click. Merely checking the status creates no login terminal.
it("opens the fixed login terminal only after its owner clicks", () => {
  fake.status = {
    operable: true,
    isError: false,
    isPending: false,
    isFetching: false,
    data: { state: "sign-in-required" },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(NativeLoginCard, { agentId: "agent-1", maySignIn: true }),
      ),
    ),
  );
  expect(document.querySelector("[data-native-login]")).toBeNull();
  const signIn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "Sign in to ChatGPT",
  );
  expect(signIn).toBeDefined();
  act(() => signIn!.click());
  expect(document.querySelector('[data-native-login="true"]')).not.toBeNull();
  expect(
    document.querySelector('a[href="https://auth.openai.com/codex/device"]'),
  ).not.toBeNull();
});

// TEST_SCENARIO: A saved login can need reauthorization. Opening its device flow does not itself mean that the new sign-in completed.
it("offers reauthorization without claiming success before Codex exits", () => {
  fake.status = {
    operable: true,
    isError: false,
    isPending: false,
    isFetching: false,
    data: { state: "signed-in" },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(NativeLoginCard, { agentId: "agent-1", maySignIn: true }),
      ),
    ),
  );
  const signIn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "Sign in again",
  );
  expect(signIn).toBeDefined();
  act(() => signIn!.click());
  expect(document.body.textContent).not.toContain("ChatGPT sign-in completed");
  act(() => fake.exit?.(0));
  expect(document.body.textContent).toContain("ChatGPT sign-in completed");
  expect(document.body.textContent).toContain("restart");
});

// TEST_SCENARIO: An expired or failed device authorization offers a new code instead of leaving the owner at exit 1. A retry starts a fresh terminal and clears the failed state.
it("starts a fresh device session after failed authorization", () => {
  fake.status = {
    operable: true,
    isError: false,
    isPending: false,
    isFetching: false,
    data: { state: "sign-in-required" },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(NativeLoginCard, { agentId: "agent-1", maySignIn: true }),
      ),
    ),
  );
  act(() =>
    Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "Sign in to ChatGPT")!
      .click(),
  );
  const initial = document
    .querySelector("[data-native-login]")!
    .getAttribute("data-session-id");
  act(() => fake.exit(1));
  expect(document.body.textContent).toContain("Sign-in didn’t finish");
  act(() =>
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent === "Get a new code")!
      .click(),
  );
  expect(
    document
      .querySelector("[data-native-login]")!
      .getAttribute("data-session-id"),
  ).not.toBe(initial);
  expect(document.body.textContent).not.toContain("Sign-in didn’t finish");
});
