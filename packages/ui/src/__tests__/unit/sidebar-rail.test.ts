// TEST_OVERVIEW: Collapsed, JanUI's sidebar stays in the layout one icon wide: a tile that expands it again, Home, the Pinned tile once the browser holds a pin, one tile per Agent in the tree's manual order with a dot while that Agent awaits an approval or holds an unread Session, and Settings.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

vi.stubGlobal("window", new EventTarget());

const env = vi.hoisted(() => ({
  pins: new Set<string>(),
  agents: [] as { id: string; name: string; state: string }[],
  approvals: [] as unknown[],
  unread: new Set<string>(),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({ view: "home", drafts: {}, pendingPermissions: [] }),
}));
vi.mock("../../modules/agents/hooks/use-sidebar-agents.js", () => ({
  useSidebarAgents: () => ({
    agents: env.agents,
    openAgentId: null,
    unreadAgentIds: env.unread,
  }),
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForOwner: () => ({ data: env.approvals }),
}));
vi.mock("../../modules/sessions/lib/pinned-sessions.js", () => ({
  usePinnedSessions: () => env.pins,
}));
vi.mock("../../modules/sessions/hooks/use-start-session.js", () => ({
  useStartSession: () => vi.fn(),
}));
vi.mock("@/components/ui/tooltip", async () => {
  const { createElement: h } = await import("react");
  return {
    Tooltip: ({ children }: { children: ReactNode }) =>
      h("div", null, children),
  };
});
vi.mock(
  "../../modules/platform/components/sidebar-v2/agent-session-list.js",
  () => ({ AgentSessionList: () => null }),
);
vi.mock("../../modules/platform/components/sidebar-v2/pinned-rows.js", () => ({
  PinnedList: () => null,
}));

const { SidebarRail } =
  await import("../../modules/platform/components/sidebar-v2/sidebar-rail.js");

const agents = [
  { id: "a1", name: "dam", state: "running" },
  { id: "a2", name: "other", state: "running" },
];

beforeEach(() => {
  env.pins = new Set();
  env.agents = agents;
  env.approvals = [];
  env.unread = new Set();
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

// TEST_SCENARIO: the pin tile appears once the browser holds a pin, since the popover it opens would otherwise be empty.
it("offers the Pinned tile only while a pin is stored", () => {
  expect(render()).not.toContain('data-testid="sidebar-rail-pinned"');
  env.pins = new Set(["a1:s1"]);
  expect(render()).toContain('data-testid="sidebar-rail-pinned"');
});

// TEST_SCENARIO: an Agent awaiting an approval, or holding an unread Session, marks its tile, and its own accessible name says which, since the dot alone is a colour.
it("marks an Agent that needs attention in its name", () => {
  expect(render()).not.toContain("needs your approval");
  env.approvals = [{ status: "pending", agentId: "a2", sessionId: "s1" }];
  expect(render()).toContain('aria-label="other, needs your approval"');
  env.approvals = [];
  env.unread = new Set(["a2"]);
  expect(render()).toContain('aria-label="other, unread"');
});
