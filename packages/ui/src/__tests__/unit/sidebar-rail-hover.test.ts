// @vitest-environment happy-dom
// TEST_OVERVIEW: JanUI's collapsed sidebar opens an Agent's popover on hover, a moment after the pointer rests on its tile, and closes it only after a grace period long enough to move into the popover; the popover carries the same session filter, New session button and actions menu as the Agent's row in the tree.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  agents: [{ id: "a1", name: "dam", state: "running" }],
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      view: "home",
      setView: () => {},
      navigateToSettings: () => {},
      navigateToSandboxHome: () => {},
    }),
}));
vi.mock("../../modules/agents/hooks/use-sidebar-agents.js", () => ({
  useSidebarAgents: () => ({
    agents: env.agents,
    openAgentId: null,
    unreadAgentIds: new Set<string>(),
  }),
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForOwner: () => ({ data: [] }),
}));
vi.mock("../../modules/sessions/lib/pinned-sessions.js", () => ({
  usePinnedSessions: () => new Set<string>(),
}));
vi.mock("../../modules/sessions/hooks/use-start-session.js", () => ({
  useStartSession: () => vi.fn(),
}));
vi.mock("../../modules/sessions/lib/agent-session-filters.js", () => ({
  useAgentSessionFilter: () => undefined,
  setAgentSessionFilter: vi.fn(),
}));
vi.mock("../../modules/agents/api/mutations.js", () => ({
  useDeleteAgent: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../modules/agents/hooks/use-confirm-delete-agent.js", () => ({
  useConfirmDeleteAgent: () => vi.fn(),
}));
vi.mock("../../modules/home/components/activity-filter-menu.js", () => ({
  ActivityFilterMenu: () => createElement("i", { "data-filter": true }),
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

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(SidebarRail, {
        onExpand: () => {},
        onNavigate: () => {},
      }),
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const tile = () => container.querySelector('[data-agent-id="a1"]')!;
const popover = () =>
  document.body.querySelector("[data-radix-popper-content-wrapper]");

function pointer(type: "pointerover" | "pointerout", related: Element | null) {
  act(() => {
    tile().dispatchEvent(
      new PointerEvent(type, { bubbles: true, relatedTarget: related }),
    );
  });
}

// TEST_SCENARIO: a resting pointer opens the popover on its own, without a click, and the popover holds the three actions the Agent's row in the tree offers.
it("opens an Agent's popover on hover and carries its row's actions", () => {
  expect(popover()).toBeNull();
  pointer("pointerover", document.body);
  act(() => void vi.advanceTimersByTime(100));
  expect(popover()).toBeNull();
  act(() => void vi.advanceTimersByTime(100));
  expect(popover()).not.toBeNull();
  expect(
    document.body.querySelector('[data-testid="sidebar-agent-new-session"]'),
  ).not.toBeNull();
  expect(
    document.body.querySelector('[data-testid="sidebar-agent-menu"]'),
  ).not.toBeNull();
  expect(document.body.querySelector("[data-filter]")).not.toBeNull();
});

// TEST_SCENARIO: the pointer leaving the tile for the popover keeps it open, and it closes only once the pointer leaves the popover for good.
it("keeps the popover open while the pointer is in it, and closes it after a grace period", () => {
  pointer("pointerover", document.body);
  act(() => void vi.advanceTimersByTime(200));
  const content = popover()!;
  pointer("pointerout", content);
  act(() => void vi.advanceTimersByTime(200));
  expect(popover()).not.toBeNull();
  act(() => void vi.advanceTimersByTime(200));
  expect(popover()).toBeNull();
});
