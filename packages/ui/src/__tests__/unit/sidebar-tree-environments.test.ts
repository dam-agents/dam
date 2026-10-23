// TEST_OVERVIEW: JanUI's sidebar tree lists an Agent's Sessions alone under its open row: a vm Agent's Environments, with the feature on, are a tab of its chat's side panel instead, so the tree neither draws them nor asks for them.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { defaultActivityFilters } from "../../modules/home/lib/activity-filter.js";

vi.stubGlobal("window", new EventTarget());

const env = vi.hoisted(() => ({ asked: [] as string[] }));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      view: "home",
      drafts: {},
      pendingPermissions: [],
      sidebarGroupBy: "agents",
      sidebarActivityFilters: defaultActivityFilters(),
      sidebarTreeToggled: new Map([["a1", true]]),
      sidebarTreeOpenAgent: null,
      setSidebarTreeOpenAgent: () => {},
    }),
}));
vi.mock("../../modules/agents/hooks/use-sidebar-agents.js", () => ({
  useSidebarAgents: () => ({
    agents: [{ id: "a1", name: "dam", state: "running", vm: true }],
    openAgentId: null,
    sessionOpen: false,
    unreadAgentIds: new Set(),
  }),
}));
vi.mock("../../modules/environments/api/queries.js", () => ({
  useEnvironmentsEnabled: () => true,
  useEnvironments: (agentId: string | null) => {
    if (agentId) env.asked.push(agentId);
    return { data: [{ id: "e1", name: "pr-42", endpoints: [] }] };
  },
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentsList: () => [],
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
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForOwner: () => ({ data: [] }),
}));
vi.mock("../../modules/home/hooks/use-activity-sessions.js", () => ({
  useActivitySessions: () => ({
    items: [],
    openSessionKey: null,
    complete: true,
    loading: false,
    unreadable: false,
  }),
  useActivityFeed: () => ({
    items: [],
    openSessionKey: null,
    loading: false,
    failed: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => {},
  }),
}));
vi.mock("../../modules/home/hooks/use-activity-conversations.js", () => ({
  useActivityConversations: () => () => undefined,
}));
vi.mock("../../modules/sessions/lib/pinned-sessions.js", () => ({
  usePinnedSessions: () => new Set(),
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
vi.mock("../../modules/platform/components/sidebar-v2/pinned-rows.js", () => ({
  FeedSessionRow: () => null,
  PinnedList: () => null,
}));
vi.mock(
  "../../modules/platform/components/sidebar-v2/agent-row-actions.js",
  () => ({
    AgentContextMenu: ({ children }: { children: ReactNode }) => children,
    AgentRowActions: () => null,
  }),
);
vi.mock(
  "../../modules/platform/components/sidebar-v2/new-agent-menu.js",
  () => ({
    NewAgentMenu: ({ children }: { children: ReactNode }) => children,
  }),
);
vi.mock(
  "../../modules/platform/components/sidebar-v2/agent-session-list.js",
  async () => {
    const { createElement: h } = await import("react");
    return { AgentSessionList: () => h("i", { "data-sessions": "" }) };
  },
);

const { SidebarTree } =
  await import("../../modules/platform/components/sidebar-v2/sidebar-tree.js");

// TEST_SCENARIO: a vm Agent with an Environment and the feature on is open in the tree; its list shows its Sessions, and no Environment row, nor a request for its Environments.
it("lists an open Agent's Sessions and none of its Environments", () => {
  const html = renderToStaticMarkup(
    createElement(TooltipProvider, null, createElement(SidebarTree)),
  );
  expect(html).toContain('data-agent-id="a1"');
  expect(html).toContain("data-sessions");
  expect(html).not.toContain("sidebar-environment");
  expect(html).not.toContain("pr-42");
  expect(env.asked).toEqual([]);
});
