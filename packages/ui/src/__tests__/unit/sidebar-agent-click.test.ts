// TEST_OVERVIEW: In the classic sidebar a click on an Agent row opens the Agent's Sessions under it, so the click always shows something true: "No sessions yet." only when the attention record loaded whole and holds no row of the Agent, else the Agent's own list, which says a hibernated Agent's Sessions show when it wakes instead of loading forever. A hibernated Agent the user clicked stays out of See all, so a second click or Show less never moves it or the See all control.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { create } from "zustand";

import { sidebarAgentFolded } from "../../modules/agents/lib/sidebar-agent-order.js";
import { useActivitySessions } from "../../modules/home/hooks/use-activity-sessions.js";
import { createSidebarSlice } from "../../modules/platform/store/sidebar.js";
import { SidebarAgentSessions } from "../../modules/sessions/components/sidebar-agent-sessions.js";
import type { PlatformStore } from "../../store.js";

const fake = vi.hoisted(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  return {
    runState: "running",
    loading: false,
    failed: false,
    attention: {} as Record<string, unknown>,
  };
});

vi.mock("../../store.js", () => {
  const state = { view: "home" };
  return {
    useStore: Object.assign(
      (select: (s: unknown) => unknown) => select(state),
      { getState: () => state },
    ),
  };
});
vi.mock("../../modules/agents/hooks/use-act-when-awake.js", () => ({
  useActWhenAwake: () => () => {},
}));
vi.mock("../../modules/agents/api/queries.js", async (original) => ({
  ...(await original<object>()),
  useAgentRunState: () => fake.runState,
  useAgentsList: () => [],
}));
vi.mock("../../modules/sessions/hooks/use-agent-session-list.js", () => ({
  useAgentSessionList: () => ({
    sessions: [],
    rowState: () => ({}),
    operable: false,
    loading: fake.loading,
    provisional: false,
    failed: fake.failed,
    retrying: false,
    retry: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPageFailed: false,
    fetchNextPage: () => {},
  }),
}));
vi.mock("../../modules/home/api/queries.js", () => ({
  useAttention: () => fake.attention,
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForOwner: () => ({ data: [] }),
}));

function openedAgent(previewComplete: boolean) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(SidebarAgentSessions, {
        agentId: "a-1",
        open: false,
        shown: true,
        preview: [],
        previewComplete,
        conversationOf: () => undefined,
        stickyClassName: "",
      }),
    ),
  );
}

function previewComplete(attention: Record<string, unknown>): boolean {
  fake.attention = attention;
  let complete: boolean | undefined;
  renderToStaticMarkup(
    createElement(() => {
      complete = useActivitySessions().complete;
      return null;
    }),
  );
  return complete!;
}

describe("the attention record answers for an Agent only once it loaded", () => {
  // TEST_SCENARIO: before the first read of the attention record ends, or after it fails, the record says nothing about an Agent, so the sidebar does not claim the Agent has no Sessions.
  it("is complete only after a successful read shorter than its limit", () => {
    expect(previewComplete({ isPending: true, isSuccess: false })).toBe(false);
    expect(
      previewComplete({ isPending: false, isError: true, isSuccess: false }),
    ).toBe(false);
    expect(
      previewComplete({
        isPending: false,
        isSuccess: true,
        data: { items: [], dismissed: [], defaultModels: [] },
      }),
    ).toBe(true);
  });
});

describe("a click on an Agent with no Sessions in the attention record", () => {
  // TEST_SCENARIO: the user clicks an Agent that has no Session in the whole, loaded attention record; the row opens to "No sessions yet." instead of showing nothing.
  it("shows No sessions yet when the record is whole", () => {
    expect(openedAgent(true)).toContain("No sessions yet.");
  });

  // TEST_SCENARIO: the attention record is cut off, still loading or failed, so it cannot say the Agent has no Session; the row opens to the Agent's own list.
  it("shows the Agent's own list when the record cannot answer", () => {
    fake.runState = "running";
    fake.loading = false;
    fake.failed = false;
    const out = openedAgent(false);
    expect(out).toContain('data-testid="sidebar-agent-sessions"');
    expect(out).toContain("No sessions yet.");
  });

  // TEST_SCENARIO: the Agent's own list fails its first read too; the row offers a retry and does not claim the Agent has no Sessions.
  it("offers a retry, not No sessions yet, when the Agent's own list fails", () => {
    fake.runState = "running";
    fake.loading = false;
    fake.failed = true;
    const out = openedAgent(false);
    expect(out).toContain('data-testid="sidebar-agent-sessions-failed"');
    expect(out).not.toContain("No sessions yet.");
    fake.failed = false;
  });

  // TEST_SCENARIO: the user clicks Retry on a failed read of the Agent's own list; while the retry runs, the row shows the busy Retry alone, not a skeleton beside it.
  it("shows no skeleton beside Retry while a failed read retries", () => {
    fake.runState = "running";
    fake.loading = true;
    fake.failed = true;
    const out = openedAgent(false);
    expect(out).toContain('data-testid="sidebar-agent-sessions-failed"');
    expect(out).not.toContain("animate-pulse");
    expect(out).toContain('aria-busy="false"');
    fake.loading = false;
    fake.failed = false;
  });

  // TEST_SCENARIO: the Agent is hibernated, so its own list cannot load until it wakes, whether or not the lookup of its last known Sessions answered; the row says so and is not busy, instead of a skeleton that never ends.
  it("says a hibernated Agent's Sessions show when it wakes", () => {
    fake.runState = "hibernated";
    fake.loading = true;
    const out = openedAgent(false);
    expect(out).toContain("Its sessions show when it wakes.");
    expect(out).toContain('aria-busy="false"');
  });
});

describe("a hibernated Agent the user clicked", () => {
  const sleeping = { id: "a-1", state: "hibernated" } as const;

  // TEST_SCENARIO: the user opens a hibernated Agent from See all, then closes it again; it stays listed, so See all neither appears nor disappears under the pointer and Show less does not hide it.
  it("stays out of See all once opened, and after it is closed again", () => {
    expect(sidebarAgentFolded({}, sleeping, null)).toBe(true);
    expect(sidebarAgentFolded({ "a-1": true }, sleeping, null)).toBe(false);
    expect(sidebarAgentFolded({ "a-1": false }, sleeping, null)).toBe(false);
  });

  // TEST_SCENARIO: with awake and asleep Agents mixed, the user opens See all, clicks one asleep Agent open and closed, then clicks Show less; that Agent stays in its place and only the other asleep Agents fold, counted right.
  it("keeps the clicked Agent in place through See all, a click, a close and Show less", () => {
    const agents = [
      { id: "awake-1", state: "running" },
      { id: "sleep-1", state: "hibernated" },
      { id: "awake-2", state: "running" },
      { id: "sleep-2", state: "hibernating" },
      { id: "sleep-3", state: "hibernated" },
    ] as const;
    const store = create<PlatformStore>()(
      (...a) => createSidebarSlice(...a) as PlatformStore,
    );
    const shown = () => {
      const { sidebarAgentOpen: overrides, sidebarShowHibernating } =
        store.getState();
      const folded = agents.filter((agent) =>
        sidebarAgentFolded(overrides, agent, null),
      );
      const listed = sidebarShowHibernating
        ? agents
        : agents.filter((agent) => !folded.includes(agent));
      return { ids: listed.map((agent) => agent.id), folded: folded.length };
    };
    const { setSidebarShowHibernating, setSidebarAgentOpen } = store.getState();

    setSidebarShowHibernating(true);
    setSidebarAgentOpen("sleep-2", true);
    expect(shown().folded).toBe(2);
    setSidebarAgentOpen("sleep-2", false);
    expect(shown().folded).toBe(2);
    setSidebarShowHibernating(false);
    expect(shown()).toEqual({
      ids: ["awake-1", "awake-2", "sleep-2"],
      folded: 2,
    });
  });
});
