// @vitest-environment happy-dom
// TEST_OVERVIEW: JanUI's "All sessions" list pages the owner's attention record: it lists the unpinned Sessions it has loaded, offers Load more while the record holds another page and fetches it on click, ignores a click while that page is already on its way, and says nothing about older Sessions being elsewhere now that the list can reach all of them.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { defaultActivityFilters } from "../../modules/home/lib/activity-filter.js";

const env = vi.hoisted(() => ({
  items: [] as unknown[],
  pinned: new Set<string>(),
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
}));

const session = (sessionId: string) => ({
  id: `a1:${sessionId}`,
  agent: { id: "a1", name: "dam", state: "running" },
  at: "2026-10-02T10:00:00Z",
  working: false,
  unread: false,
  needsApproval: false,
  session: {
    agentId: "a1",
    sessionId,
    mode: "chat",
    type: "regular",
    title: sessionId,
    harness: null,
    working: false,
    createdAt: "2026-10-01T10:00:00Z",
    activityAt: "2026-10-02T10:00:00Z",
    seenAt: null,
    scheduleId: null,
    threadTs: null,
  },
});

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      view: "home",
      setView: () => {},
      navigateToSettings: () => {},
      setKitBrowserOpen: () => {},
      sidebarGroupBy: "all",
      sidebarActivityFilters: defaultActivityFilters(),
      sidebarTreeToggled: new Map(),
      sidebarTreeOpenAgent: null,
      setSidebarTreeOpenAgent: () => {},
    }),
}));
vi.mock("../../modules/agents/hooks/use-sidebar-agents.js", () => ({
  useSidebarSharedAgents: () => ({
    shared: [],
    active: [],
    folded: [],
    openAgentId: null,
  }),
  useSidebarAgents: () => ({
    agents: [{ id: "a1", name: "dam", state: "running" }],
    openAgentId: null,
    sessionOpen: false,
    unreadAgentIds: new Set(),
  }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentsList: () => [{ id: "a1", name: "dam", state: "running" }],
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForOwner: () => ({ data: [] }),
}));
vi.mock("../../modules/home/hooks/use-activity-sessions.js", () => ({
  useActivitySessions: () => ({
    items: env.items,
    openSessionKey: null,
    complete: true,
    loading: false,
    unreadable: false,
  }),
  useActivityFeed: () => ({
    items: env.items,
    openSessionKey: null,
    loading: false,
    failed: false,
    hasNextPage: env.hasNextPage,
    isFetchingNextPage: env.isFetchingNextPage,
    fetchNextPage: env.fetchNextPage,
  }),
}));
vi.mock("../../modules/home/hooks/use-activity-conversations.js", () => ({
  useActivityConversations: () => () => undefined,
}));
vi.mock("../../modules/sessions/lib/pinned-sessions.js", () => ({
  usePinnedSessions: () => env.pinned,
}));
vi.mock("../../modules/sessions/lib/agent-session-filters.js", () => ({
  useAgentSessionFilter: () => undefined,
  setAgentSessionFilter: () => {},
}));
vi.mock("../../modules/home/components/activity-filter-menu.js", () => ({
  ActivityFilterMenu: () => null,
}));
vi.mock("../../modules/sessions/hooks/use-start-session.js", () => ({
  useStartSession: () => vi.fn(),
}));
vi.mock("../../modules/agents/hooks/use-auto-wake-on-sidebar-open.js", () => ({
  useAutoWakeOnSidebarOpen: () => {},
}));
vi.mock("../../modules/agents/hooks/use-order-drag.js", () => ({
  useOrderDrag: () => ({ dragProps: {}, indicator: null }),
}));
vi.mock("../../modules/agents/hooks/use-sidebar-order-actions.js", () => ({
  useSidebarOrderActions: () => ({ ready: true }),
}));
vi.mock(
  "../../modules/platform/components/sidebar-v2/pinned-rows.js",
  async () => {
    const { createElement: h } = await import("react");
    return {
      FeedSessionRow: ({
        item,
      }: {
        item: { session: { sessionId: string } };
      }) => h("i", { "data-session": item.session.sessionId }),
      PinnedList: () => null,
    };
  },
);
vi.mock(
  "../../modules/platform/components/sidebar-v2/agent-row-actions.js",
  () => ({
    AgentContextMenu: ({ children }: { children: ReactNode }) => children,
    AgentRowActions: () => null,
  }),
);
vi.mock(
  "../../modules/platform/components/sidebar-v2/new-agent-menu.js",
  () => ({ NewAgentMenu: ({ children }: { children: ReactNode }) => children }),
);
vi.mock(
  "../../modules/platform/components/sidebar-v2/agent-session-list.js",
  () => ({ AgentSessionList: () => null }),
);
vi.mock(
  "../../modules/platform/components/sidebar-v2/sidebar-group-by-menu.js",
  () => ({
    GroupByMenu: () => null,
  }),
);

const { SidebarTree } =
  await import("../../modules/platform/components/sidebar-v2/sidebar-tree.js");

let root: Root;
let container: HTMLDivElement;

const render = () =>
  act(() =>
    root.render(
      createElement(TooltipProvider, null, createElement(SidebarTree)),
    ),
  );
const more = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-testid="sidebar-flat-more"]',
  );
const rows = () =>
  [...container.querySelectorAll("[data-session]")].map((row) =>
    row.getAttribute("data-session"),
  );

beforeEach(() => {
  vi.clearAllMocks();
  env.items = [session("s3"), session("s2"), session("s1")];
  env.pinned = new Set();
  env.hasNextPage = false;
  env.isFetchingNextPage = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  render();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// TEST_SCENARIO: with the record holding another page, the list ends in a Load more row; without one, it ends in the last Session.
it("offers Load more only while the record has another page", () => {
  expect(more()).toBeNull();
  env.hasNextPage = true;
  render();
  expect(more()?.textContent).toBe("Load more");
});

// TEST_SCENARIO: Load more fetches the next page of the record, and a click while that page is already on its way changes nothing.
it("fetches the next page on Load more, once", () => {
  env.hasNextPage = true;
  render();
  act(() => more()!.click());
  expect(env.fetchNextPage).toHaveBeenCalledTimes(1);

  env.isFetchingNextPage = true;
  render();
  expect(more()?.textContent).toBe("Loading…");
  expect(more()?.getAttribute("aria-busy")).toBe("true");
  act(() => more()!.click());
  expect(env.fetchNextPage).toHaveBeenCalledTimes(1);
});

// TEST_SCENARIO: the list shows every unpinned Session it loaded; a pinned one waits in the Pinned section instead, and no line claims older Sessions live only under their Agent.
it("lists the loaded Sessions and keeps the pinned ones out", () => {
  env.pinned = new Set(["a1:s2"]);
  render();
  expect(rows()).toEqual(["s3", "s1"]);
  expect(container.textContent).not.toContain("Older sessions show under");
});
