// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { useAutoWakeOnOpen } from "../../modules/agents/hooks/use-auto-wake-on-open.js";
import { useAutoWakeOnSidebarOpen } from "../../modules/agents/hooks/use-auto-wake-on-sidebar-open.js";
import { nextAutoWake } from "../../modules/agents/lib/auto-wake.js";
import { useStore } from "../../store.js";
import type { AgentView } from "../../types.js";

// TEST_OVERVIEW: opening a sleeping agent's chat or its sidebar session list wakes it once per open, and a wake already running counts as that open's wake. A sidebar open lasts until its row closes, so a sidebar that mounts again does not wake the agent again. Re-renders and list refetches in the same open do not wake it again, leaving and reopening does, and an agent over its budget, disabled or already awake is not woken.

const wake = vi.hoisted(() => vi.fn());
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: (id: string | null) =>
    id === "a1"
      ? { id: "a1", state: "hibernated", overBudget: false, disabled: false }
      : null,
}));
vi.mock("../../modules/agents/hooks/use-wake-agent.js", () => ({
  useWakeAgent: () => ({ wake }),
}));

const asleep = {
  state: "hibernated" as const,
  overBudget: false,
  disabled: false,
};

describe("waking a sleeping agent on open", () => {
  // TEST_SCENARIO: the first render with the agent loaded wakes it; later renders of the same open do not.
  it("wakes once per open", () => {
    const first = nextAutoWake(null, "a1", asleep);
    expect(first).toEqual({ decidedFor: "a1", wake: true });
    expect(nextAutoWake(first.decidedFor, "a1", asleep).wake).toBe(false);
  });

  // TEST_SCENARIO: leaving the chat clears the open, so the next open of the same agent wakes it again.
  it("wakes again after the chat is left and reopened", () => {
    const left = nextAutoWake("a1", null, undefined);
    expect(left.decidedFor).toBeNull();
    expect(nextAutoWake(left.decidedFor, "a1", asleep).wake).toBe(true);
  });

  // TEST_SCENARIO: switching to another agent is a new open of that agent.
  it("wakes the agent switched to", () => {
    expect(nextAutoWake("a1", "a2", asleep)).toEqual({
      decidedFor: "a2",
      wake: true,
    });
  });

  // TEST_SCENARIO: the decision waits until the agent is in the list.
  it("waits for the agent to load", () => {
    expect(nextAutoWake(null, "a1", undefined)).toEqual({
      decidedFor: null,
      wake: false,
    });
  });

  // TEST_SCENARIO: a wake from another view or a click is still running when the open decides; the open counts it as its own and asks for no second wake.
  it("counts a running wake as the open's wake", () => {
    expect(nextAutoWake(null, "a1", asleep, true)).toEqual({
      decidedFor: "a1",
      wake: false,
    });
  });

  // TEST_SCENARIO: an over-budget, disabled or awake agent is not woken, and the open still counts as decided.
  it("leaves over-budget, disabled and awake agents alone", () => {
    expect(nextAutoWake(null, "a1", { ...asleep, overBudget: true })).toEqual({
      decidedFor: "a1",
      wake: false,
    });
    expect(nextAutoWake(null, "a1", { ...asleep, disabled: true }).wake).toBe(
      false,
    );
    expect(nextAutoWake(null, "a1", { ...asleep, state: "running" }).wake).toBe(
      false,
    );
  });
});

function Opener() {
  useAutoWakeOnOpen("a1");
  return null;
}

function openView() {
  const root = createRoot(document.createElement("div"));
  const render = () => act(() => root.render(createElement(Opener)));
  render();
  return { render, close: () => act(() => root.unmount()) };
}

describe("an open while the agent is still falling asleep", () => {
  // TEST_SCENARIO: the view opens while the agent is hibernating; the open waits instead of deciding, and wakes the agent once it is asleep.
  it("wakes the agent once it is asleep", () => {
    const falling = { ...asleep, state: "hibernating" as const };
    const waiting = nextAutoWake(null, "a1", falling);
    expect(waiting).toEqual({ decidedFor: null, wake: false });
    expect(nextAutoWake(waiting.decidedFor, "a1", asleep).wake).toBe(true);
  });

  // TEST_SCENARIO: the user leaves a decided open for a hibernating agent and comes back; the earlier open has ended, so the agent come back to is woken again.
  it("ends the previous open", () => {
    const falling = { ...asleep, state: "hibernating" as const };
    const away = nextAutoWake("a1", "a2", falling);
    expect(nextAutoWake(away.decidedFor, "a1", asleep).wake).toBe(true);
  });
});

describe("a wake already running", () => {
  // TEST_SCENARIO: the chat and the sidebar list open the same sleeping agent together, or a wake from a click still runs; the open counts that wake as its own, so it asks for no second wake, and it does not wake the agent when that wake ends and fails.
  it("counts as the open's wake", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    wake.mockClear();
    const { setRestartingAgent, clearRestartingAgent } = useStore.getState();
    setRestartingAgent("a1", {
      seenNonRunning: false,
      clickedAt: Date.now(),
      parkedAtClick: false,
    });
    const view = openView();
    expect(wake).not.toHaveBeenCalled();
    act(() => clearRestartingAgent("a1"));
    view.render();
    expect(wake).not.toHaveBeenCalled();
    view.close();

    const next = openView();
    expect(wake).toHaveBeenCalledExactlyOnceWith("a1");
    next.close();
  });
});

const sleepingRow = { id: "a1", ...asleep } as AgentView;

function Row({ open }: { open: boolean }) {
  useAutoWakeOnSidebarOpen(sleepingRow, open);
  return null;
}

function mountRow(open: boolean) {
  const root = createRoot(document.createElement("div"));
  const render = (isOpen: boolean) =>
    act(() => root.render(createElement(Row, { open: isOpen })));
  render(open);
  return { render, unmount: () => act(() => root.unmount()) };
}

describe("a sidebar row's open", () => {
  // TEST_SCENARIO: the user opens a sleeping agent's row; the sidebar then mounts again (a move between a chat and Home), and the mobile drawer mounts its own copy of the row, both with the row still open; the agent is woken once, since the open goes on. Closing the row and opening it again is a new open and wakes it again.
  it("wakes once per open of the row, across remounts", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    wake.mockClear();
    const first = mountRow(true);
    expect(wake).toHaveBeenCalledExactlyOnceWith("a1");
    first.unmount();
    const again = mountRow(true);
    const drawer = mountRow(true);
    expect(wake).toHaveBeenCalledOnce();

    again.render(false);
    drawer.unmount();
    again.render(true);
    expect(wake).toHaveBeenCalledTimes(2);
    again.unmount();
  });
});
