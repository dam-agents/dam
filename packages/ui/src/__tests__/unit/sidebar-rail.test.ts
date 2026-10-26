// TEST_OVERVIEW: Collapsed, JanUI's sidebar stays in the layout one icon wide: a tile that expands it again, Home, then what the tree lists under its Agents label — one tile per Agent in the tree's manual order with a dot while that Agent awaits an approval or holds an unread Session, or, while the grouping is All sessions, one tile per Session with its harness icon and its name in a tooltip — a New agent tile leading them, and Settings.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

import { defaultActivityFilters } from "../../modules/home/lib/activity-filter.js";

vi.stubGlobal("window", new EventTarget());

const env = vi.hoisted(() => ({
  agents: [] as { id: string; name: string; state: string }[],
  approvals: [] as unknown[],
  unread: new Set<string>(),
  groupBy: "agents" as "agents" | "all",
  filters: undefined as unknown,
  sessions: [] as unknown[],
  openSessionKey: null as string | null,
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      view: "home",
      drafts: {},
      pendingPermissions: [],
      sidebarGroupBy: env.groupBy,
      sidebarActivityFilters: env.filters,
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
    agents: env.agents,
    openAgentId: null,
    unreadAgentIds: env.unread,
  }),
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForOwner: () => ({ data: env.approvals }),
}));
vi.mock("../../modules/home/hooks/use-activity-sessions.js", () => ({
  useActivitySessions: () => ({
    items: env.sessions,
    openSessionKey: env.openSessionKey,
    complete: true,
    loading: false,
    unreadable: false,
  }),
  useActivityFeed: () => ({
    items: env.sessions,
    openSessionKey: env.openSessionKey,
    loading: false,
    failed: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => {},
  }),
}));
vi.mock("../../modules/agents/api/mutations.js", () => ({
  useDeleteAgent: () => ({ mutate: () => {} }),
  useSetAgentDisabled: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("../../modules/agents/hooks/use-restart-agent.js", () => ({
  useRestartAgent: () => ({ restart: () => {} }),
}));
vi.mock("../../modules/features/hooks/use-unified-right-toolbar.js", () => ({
  useUnifiedRightToolbar: () => false,
}));
vi.mock("../../modules/agents/hooks/use-confirm-delete-agent.js", () => ({
  useConfirmDeleteAgent: () => async () => false,
}));
vi.mock("../../modules/agents/hooks/use-create-default-agent.js", () => ({
  useCreateDefaultAgent: () => ({ ready: true, create: () => {} }),
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
vi.mock("@/components/ui/tooltip", async () => {
  const { createElement: h } = await import("react");
  return {
    Tooltip: ({
      content,
      children,
    }: {
      content: string;
      children: ReactNode;
    }) => h("div", { "data-tooltip": content }, children),
  };
});
vi.mock(
  "../../modules/platform/components/sidebar-v2/agent-session-list.js",
  () => ({ AgentSessionList: () => null }),
);

const { SidebarRail } =
  await import("../../modules/platform/components/sidebar-v2/sidebar-rail.js");

const agents = [
  { id: "a1", name: "dam", state: "running" },
  { id: "a2", name: "other", state: "running" },
];

const session = (
  sessionId: string,
  title: string | null,
  extra: Record<string, unknown> = {},
) => ({
  id: `a1:${sessionId}`,
  agent: agents[0],
  working: false,
  unread: false,
  needsApproval: false,
  session: {
    agentId: "a1",
    sessionId,
    mode: "chat",
    type: "regular",
    title,
    harness: "claude-code",
    working: false,
    ...extra,
  },
});

beforeEach(() => {
  env.agents = agents;
  env.approvals = [];
  env.unread = new Set();
  env.groupBy = "agents";
  env.filters = defaultActivityFilters();
  env.sessions = [];
  env.openSessionKey = null;
});

const render = () =>
  renderToStaticMarkup(
    createElement(SidebarRail, { onExpand: () => {}, onNavigate: () => {} }),
  );

// TEST_SCENARIO: the collapsed sidebar never leaves the page without a way back to the tree, and draws one tile per Agent in the order the tree keeps.
it("draws the expand, home and settings tiles and one tile per Agent", () => {
  const html = render();
  expect(html).toContain('data-testid="sidebar-rail-expand"');
  expect(html).toContain("Expand navigation");
  expect(html).toContain('data-testid="sidebar-home-row"');
  expect(html).toContain('data-testid="sidebar-settings-row"');
  expect(
    [
      ...html.matchAll(
        /data-testid="sidebar-rail-agent" data-agent-id="(\w+)"/g,
      ),
    ].map((m) => m[1]),
  ).toEqual(["a1", "a2"]);
});

// TEST_SCENARIO: the Agents lead with a New agent tile, in the same column and at the same size as theirs.
it("leads the Agent tiles with a New agent tile", () => {
  const html = render();
  expect(html).toContain('data-testid="sidebar-rail-new-agent"');
  expect(html).toContain('aria-label="New agent"');
  // UNIT_BOUNDARY_DESCRIPTION: the outlined face stands until the pointer arrives, and the filled one takes its place.
  expect(html).toContain("group-hover:hidden");
  expect(html).toContain("hidden group-hover:block");
});

// TEST_SCENARIO: with the grouping on All sessions the rail draws the Sessions the tree's flat list would, in the same order, each named by its Agent and its title since the rail has no room for either.
it("draws a tile per Session while the grouping is All sessions", () => {
  env.groupBy = "all";
  env.sessions = [session("s1", "Fix the parser"), session("s2", null)];
  const html = render();
  expect(
    [...html.matchAll(/data-session-id="(\w+)"/g)].map((m) => m[1]),
  ).toEqual(["s1", "s2"]);
  expect(html).toContain('data-tooltip="dam — Fix the parser"');
  expect(html).toContain('data-tooltip="dam — (no title · s2)"');
  expect(html).toContain('aria-label="dam — Fix the parser"');
  // UNIT_BOUNDARY_DESCRIPTION: the Agent avatars belong to the other grouping, and a Session is drawn by its harness rather than by its Agent.
  expect(html).not.toContain('data-testid="sidebar-rail-agent"');
  expect(html).toContain('aria-label="Claude"');
});

// TEST_SCENARIO: the header's filter narrows the Session tiles as it narrows the tree's list, and the Session the page holds is the one tile marked as current.
it("narrows the Session tiles by the header filter and marks the open one", () => {
  env.groupBy = "all";
  env.sessions = [
    session("s1", "Fix the parser", { working: true }),
    { ...session("s2", "Idle one"), unread: true },
  ];
  env.openSessionKey = "a1:s2";
  expect(render()).toContain('data-session-id="s1"');
  env.filters = { channelTypes: new Set(["chat"]), state: "unread" };
  const html = render();
  expect(html).not.toContain('data-session-id="s1"');
  expect(html).toContain('aria-current="page"');
});

// TEST_SCENARIO: an Agent awaiting an approval, or holding an unread Session, marks its tile, and its own accessible name says which, since the dot alone is a colour, and the name leads with the New session action its click takes.
it("marks an Agent that needs attention in its name", () => {
  expect(render()).not.toContain("needs your approval");
  env.approvals = [{ status: "pending", agentId: "a2", sessionId: "s1" }];
  expect(render()).toContain(
    'aria-label="New session with other, needs your approval"',
  );
  env.approvals = [];
  env.unread = new Set(["a2"]);
  expect(render()).toContain('aria-label="New session with other, unread"');
});
