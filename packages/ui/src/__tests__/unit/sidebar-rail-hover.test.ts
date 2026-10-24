// @vitest-environment happy-dom
// TEST_OVERVIEW: JanUI's collapsed sidebar opens an Agent's new-session page when its tile is clicked, and its popover on hover, a moment after the pointer rests on the tile, closing it only after a grace period long enough to move into the popover; the popover carries the same session filter and actions menu as the Agent's row in the tree.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { defaultActivityFilters } from "../../modules/home/lib/activity-filter.js";

const env = vi.hoisted(() => ({
  agents: [
    { id: "a1", name: "dam", state: "running" },
    { id: "a2", name: "other", state: "running" },
  ],
  startSession: vi.fn(),
  navigated: vi.fn(),
  filtered: vi.fn(),
  createAgent: vi.fn(),
  openSession: vi.fn(),
  openKits: vi.fn(),
  sessions: [] as unknown[],
  filters: undefined as unknown,
  groupBy: "agents" as "agents" | "all",
  hover: true,
  feedHasNext: false,
  feedFetching: false,
  fetchNextPage: vi.fn(),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      view: "home",
      setView: () => {},
      navigateToSettings: () => {},
      navigateToSandboxHome: () => {},
      setKitBrowserOpen: env.openKits,
      sidebarGroupBy: env.groupBy,
      sidebarActivityFilters: env.filters,
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
vi.mock("../../modules/sessions/hooks/use-start-session.js", () => ({
  useStartSession: () => env.startSession,
}));
vi.mock("../../modules/sessions/lib/agent-session-filters.js", () => ({
  useAgentSessionFilter: () => undefined,
  setAgentSessionFilter: vi.fn(),
}));
vi.mock("../../modules/agents/api/mutations.js", () => ({
  useDeleteAgent: () => ({ mutate: vi.fn() }),
  useSetAgentDisabled: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../modules/agents/hooks/use-restart-agent.js", () => ({
  useRestartAgent: () => ({ restart: () => {} }),
}));
vi.mock("../../modules/features/hooks/use-unified-right-toolbar.js", () => ({
  useUnifiedRightToolbar: () => false,
}));
vi.mock("../../modules/agents/hooks/use-confirm-delete-agent.js", () => ({
  useConfirmDeleteAgent: () => vi.fn(),
}));
vi.mock("../../modules/agents/hooks/use-create-default-agent.js", () => ({
  useCreateDefaultAgent: () => ({ ready: true, create: env.createAgent }),
}));
vi.mock("../../modules/home/components/activity-filter-menu.js", async () => {
  const { createElement: h, useState } = await import("react");
  const { createPortal } = await import("react-dom");
  // UNIT_BOUNDARY_DESCRIPTION: the stand-in filter menu renders in a portal of its own, the shape every menu in the popover has.
  return {
    ActivityFilterMenu: () => {
      const [open, setOpen] = useState(false);
      return h(
        "div",
        null,
        h(
          "button",
          {
            type: "button",
            "data-testid": "rail-popover-filter",
            onClick: () => setOpen((prev) => !prev),
          },
          "filter",
        ),
        open &&
          createPortal(
            h(
              "div",
              { role: "menu", "data-state": "open" },
              h(
                "div",
                {
                  role: "menuitemcheckbox",
                  "data-testid": "rail-popover-filter-option",
                  onClick: () => {
                    env.filtered("unread");
                    setOpen(false);
                  },
                },
                "Unread only",
              ),
            ),
            document.body,
          ),
      );
    },
  };
});
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
vi.mock("../../modules/home/hooks/use-activity-sessions.js", () => ({
  useActivitySessions: () => ({
    items: env.sessions,
    openSessionKey: null,
    complete: true,
    loading: false,
    unreadable: false,
  }),
  useActivityFeed: () => ({
    items: env.sessions,
    openSessionKey: null,
    loading: false,
    failed: false,
    hasNextPage: env.feedHasNext,
    isFetchingNextPage: env.feedFetching,
    fetchNextPage: env.fetchNextPage,
  }),
}));
vi.mock("../../modules/sessions/hooks/use-open-session.js", () => ({
  useOpenSession: () => env.openSession,
}));

const { SidebarRail } =
  await import("../../modules/platform/components/sidebar-v2/sidebar-rail.js");

let root: Root;
let container: HTMLDivElement;

const element = () =>
  createElement(SidebarRail, { onExpand: () => {}, onNavigate: env.navigated });

beforeEach(() => {
  vi.clearAllMocks();
  env.groupBy = "agents";
  env.filters = defaultActivityFilters();
  env.sessions = [];
  env.hover = true;
  env.feedHasNext = false;
  env.feedFetching = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(hover: hover)" && env.hover,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(element()));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const tile = (id = "a1") =>
  container.querySelector<HTMLButtonElement>(`[data-agent-id="${id}"]`)!;
const popover = () =>
  document.body.querySelector("[data-radix-popper-content-wrapper]");

function pointer(
  type: "pointerover" | "pointerout",
  related: Element | null,
  id = "a1",
) {
  act(() => {
    tile(id).dispatchEvent(
      new PointerEvent(type, { bubbles: true, relatedTarget: related }),
    );
  });
}

// TEST_SCENARIO: a resting pointer opens the popover on its own, without a click, and the popover holds the filter and the actions menu the Agent's row in the tree offers.
it("opens an Agent's popover on hover and carries its row's actions", () => {
  expect(popover()).toBeNull();
  pointer("pointerover", document.body);
  act(() => void vi.advanceTimersByTime(100));
  expect(popover()).toBeNull();
  act(() => void vi.advanceTimersByTime(100));
  expect(popover()).not.toBeNull();
  expect(
    document.body.querySelector('[data-testid="sidebar-agent-menu"]'),
  ).not.toBeNull();
  expect(
    document.body.querySelector('[data-testid="rail-popover-filter"]'),
  ).not.toBeNull();
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

// TEST_SCENARIO: a device that cannot hover opens the popover from a tap, since nothing else would open it, and reaches the Agent's new-session page through the popover's row instead.
it("opens the popover on a tap where the device cannot hover", () => {
  env.hover = false;
  act(() => tile().click());
  expect(popover()).not.toBeNull();
  expect(env.startSession).not.toHaveBeenCalled();
  expect(env.navigated).not.toHaveBeenCalled();
});

// TEST_SCENARIO: clicking an Agent's tile in the rail takes the same action as its New session row, now that hover opens the popover and leaves the click free; a right click on the tile opens the Agent's actions menu instead, at the pointer.
it("opens the Agent's new-session page on click", () => {
  act(() => tile().click());
  expect(env.startSession).toHaveBeenCalledWith("a1");
  expect(env.navigated).toHaveBeenCalled();
  expect(popover()).toBeNull();
});

it("opens the Agent's menu on a right click", () => {
  vi.clearAllMocks();
  act(() => {
    tile().dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 40,
        clientY: 80,
      }),
    );
  });
  expect(document.body.textContent).toContain("Configure");
  expect(env.startSession).not.toHaveBeenCalled();
});

// TEST_SCENARIO: the pointer moving from one Agent's tile to the next leaves the second Agent's popover open: the first tile's close timer must not take the second's popover down with it.
it("keeps the next Agent's popover open when the pointer moves on", () => {
  pointer("pointerover", document.body);
  act(() => void vi.advanceTimersByTime(200));
  expect(popover()).not.toBeNull();
  pointer("pointerout", tile("a2"));
  pointer("pointerover", document.body, "a2");
  act(() => void vi.advanceTimersByTime(400));
  expect(popover()).not.toBeNull();
  expect(popover()!.textContent).toContain("other");
});

// TEST_SCENARIO: the filter menu opens in a portal of its own, outside the popover's own box; the popover waits for it to shut and then for its own grace, and picking an option applies it and leaves the popover standing.
it("keeps the popover open while an option is picked from its filter menu", () => {
  // UNIT_BOUNDARY_DESCRIPTION: the filter button lives in the popover, so finding it says the popover itself is still mounted.
  const popoverOpen = () =>
    document.body.querySelector('[data-testid="rail-popover-filter"]');
  pointer("pointerover", document.body);
  act(() => void vi.advanceTimersByTime(200));
  expect(popoverOpen()).not.toBeNull();
  act(() =>
    document.body
      .querySelector<HTMLButtonElement>('[data-testid="rail-popover-filter"]')!
      .click(),
  );
  const option = document.body.querySelector<HTMLElement>(
    '[data-testid="rail-popover-filter-option"]',
  )!;
  expect(option).not.toBeNull();
  // UNIT_BOUNDARY_DESCRIPTION: the pointer steps off the tile into the popover, then out of the popover's box towards the menu.
  pointer("pointerout", popover()!);
  const content = popover()!.firstElementChild!;
  act(() => {
    content.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget: document.body,
      }),
    );
  });
  act(() => void vi.advanceTimersByTime(400));
  expect(popoverOpen()).not.toBeNull();
  act(() => option.click());
  expect(env.filtered).toHaveBeenCalledWith("unread");
  act(() => void vi.advanceTimersByTime(200));
  expect(popoverOpen()).not.toBeNull();
});

// TEST_SCENARIO: once the rail has a popover up, the pointer running along the rail shows the tile under it at once, without sitting out the open delay again.
it("switches to the next Agent's popover at once while one is up", () => {
  pointer("pointerover", document.body);
  act(() => void vi.advanceTimersByTime(200));
  expect(popover()!.textContent).toContain("dam");
  pointer("pointerout", tile("a2"));
  pointer("pointerover", document.body, "a2");
  expect(popover()!.textContent).toContain("other");
});

// TEST_SCENARIO: a pointer that left the rail for longer than the close grace starts over, so the next tile it rests on opens after the full delay rather than jumping up.
it("waits out the open delay again once the rail has been quiet", () => {
  pointer("pointerover", document.body);
  act(() => void vi.advanceTimersByTime(200));
  expect(popover()).not.toBeNull();
  pointer("pointerout", document.body);
  for (let i = 0; i < 6; i++) act(() => void vi.advanceTimersByTime(100));
  expect(popover()).toBeNull();
  pointer("pointerover", document.body, "a2");
  expect(popover()).toBeNull();
  act(() => void vi.advanceTimersByTime(200));
  expect(popover()!.textContent).toContain("other");
});

// TEST_SCENARIO: clicking an Agent's tile opens its new-session page and leaves the popover it opened on hover in place, so the pointer is not robbed of the rows it was reaching for.
it("leaves the popover open when the tile is clicked", () => {
  pointer("pointerover", document.body);
  act(() => void vi.advanceTimersByTime(200));
  expect(popover()).not.toBeNull();
  act(() => tile().click());
  expect(env.startSession).toHaveBeenCalledWith("a1");
  act(() => void vi.advanceTimersByTime(400));
  expect(popover()).not.toBeNull();
});

// TEST_SCENARIO: the rail leads its Agents with a New agent tile, which asks which kind of Agent to make rather than making one at once, and stands where the New agent row leading the expanded list stands.
it("asks which kind of Agent the New agent tile makes", () => {
  const newAgent = container.querySelector<HTMLButtonElement>(
    '[data-testid="sidebar-rail-new-agent"]',
  )!;
  expect(newAgent).not.toBeNull();
  expect(newAgent.getAttribute("aria-haspopup")).toBe("menu");
  const tiles = [
    ...container.querySelectorAll(
      '[data-testid="sidebar-rail-agent"], [data-testid="sidebar-rail-new-agent"]',
    ),
  ];
  expect(tiles[0]).toBe(newAgent);
  act(() => {
    newAgent.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  const generalist = document.querySelector<HTMLElement>(
    '[data-testid="new-generalist-agent"]',
  );
  const fromKit = document.querySelector<HTMLElement>(
    '[data-testid="new-agent-from-kit"]',
  );
  expect(generalist?.textContent).toBe("New generalist agent");
  expect(fromKit?.textContent).toBe("New from a starter kit");
  // UNIT_BOUNDARY_DESCRIPTION: opening the menu makes nothing; the Agent the tile used to make on its own waits behind the first item.
  expect(env.createAgent).not.toHaveBeenCalled();
  act(() => generalist!.click());
  expect(env.createAgent).toHaveBeenCalled();
  expect(env.navigated).toHaveBeenCalled();
});

// TEST_SCENARIO: the second item opens the starter kits, so the collapsed rail reaches the kits a wide window reaches from the same row.
it("opens the starter kits from the New agent tile", () => {
  const newAgent = container.querySelector<HTMLButtonElement>(
    '[data-testid="sidebar-rail-new-agent"]',
  )!;
  act(() => {
    newAgent.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  act(() =>
    document
      .querySelector<HTMLElement>('[data-testid="new-agent-from-kit"]')!
      .click(),
  );
  expect(env.openKits).toHaveBeenCalledWith(true);
  expect(env.createAgent).not.toHaveBeenCalled();
});

// TEST_SCENARIO: with the grouping on All sessions the rail lists Sessions rather than Agents, and a click on one opens that Session where the tree's own row would, with no popover in the way.
it("opens the Session a rail tile stands for", () => {
  env.groupBy = "all";
  env.sessions = [
    {
      id: "a1:s9",
      agent: env.agents[0],
      working: false,
      unread: false,
      needsApproval: false,
      session: {
        agentId: "a1",
        sessionId: "s9",
        mode: "chat",
        type: "regular",
        title: "Fix the parser",
        harness: "claude-code",
        working: false,
      },
    },
  ];
  act(() => root.render(element()));
  const sessionTile = container.querySelector<HTMLButtonElement>(
    '[data-testid="sidebar-rail-session"]',
  )!;
  expect(sessionTile.getAttribute("aria-label")).toBe("dam — Fix the parser");
  act(() => sessionTile.click());
  expect(env.openSession).toHaveBeenCalledWith("a1", "s9", "chat");
  expect(env.navigated).toHaveBeenCalled();
  expect(env.startSession).not.toHaveBeenCalled();
});

const sessionTileItem = () => ({
  id: "a1:s9",
  agent: env.agents[0],
  at: "2026-10-02T10:00:00Z",
  working: false,
  unread: false,
  needsApproval: false,
  session: {
    agentId: "a1",
    sessionId: "s9",
    mode: "chat",
    type: "regular",
    title: "Fix the parser",
    harness: "claude-code",
    working: false,
    createdAt: "2026-10-01T10:00:00Z",
    activityAt: "2026-10-02T10:00:00Z",
    seenAt: null,
    scheduleId: null,
    threadTs: null,
  },
});

function scrollRail(scrollTop: number) {
  const rail = container.querySelector<HTMLElement>(
    '[data-testid="sidebar-rail"]',
  )!;
  Object.defineProperty(rail, "scrollTop", {
    configurable: true,
    value: scrollTop,
  });
  Object.defineProperty(rail, "clientHeight", {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(rail, "scrollHeight", {
    configurable: true,
    value: 800,
  });
  act(() => rail.dispatchEvent(new Event("scroll", { bubbles: true })));
}

// TEST_SCENARIO: the rail has no room for a Load more button, so nearing the end of its column loads the record's next page once; a page already on its way, the end of the record, and Group by agents all leave the scroll alone.
it("loads the next page of Session tiles near the end of the rail", () => {
  env.groupBy = "all";
  env.sessions = [sessionTileItem()];
  env.feedHasNext = true;
  act(() => root.render(element()));

  scrollRail(100);
  expect(env.fetchNextPage).not.toHaveBeenCalled();

  scrollRail(500);
  expect(env.fetchNextPage).toHaveBeenCalledTimes(1);

  env.feedFetching = true;
  act(() => root.render(element()));
  scrollRail(500);
  expect(env.fetchNextPage).toHaveBeenCalledTimes(1);

  env.feedFetching = false;
  env.feedHasNext = false;
  act(() => root.render(element()));
  scrollRail(500);
  expect(env.fetchNextPage).toHaveBeenCalledTimes(1);

  env.feedHasNext = true;
  env.groupBy = "agents";
  act(() => root.render(element()));
  scrollRail(500);
  expect(env.fetchNextPage).toHaveBeenCalledTimes(1);
});
