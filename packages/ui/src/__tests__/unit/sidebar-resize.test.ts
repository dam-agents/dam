// @vitest-environment happy-dom
// TEST_OVERVIEW: The navigation's edge is dragged, resized from the keyboard and clamped, so the page beside it keeps the width it needs and a drag can put the navigation away and bring it back. The handle floats over the border it drags instead of standing beside it, so the page starts at the navigation's edge and its own rules reach it.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { MIN_CONTENT_WIDTH } from "../../lib/breakpoints.js";
import {
  SIDEBAR_COLLAPSED_W,
  SIDEBAR_MIN_W,
  sidebarMaxWidth,
  snapSidebarWidth,
} from "../../modules/platform/lib/sidebar-layout.js";

const fake = vi.hoisted(() => ({
  store: {
    sidebarExpanded: true,
    setSidebarExpanded: () => {},
    sidePanelTab: null as string | null,
    view: "home",
  },
  width: {
    width: 260,
    resizing: false,
    resize: () => {},
    endResize: () => {},
  },
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) => select(fake.store),
}));
vi.mock("@/hooks/use-is-desktop", () => ({ useIsWideDesktop: () => true }));
vi.mock("../../modules/platform/hooks/use-sidebar-layout.js", () => ({
  useSidebarWidth: () => fake.width,
}));
vi.mock("../../modules/platform/hooks/use-sidebar-destinations.js", () => ({
  useSidebarDestinations: () => ({ home: { navigate: () => {} } }),
}));
vi.mock("../../modules/platform/components/sidebar/sidebar-content.js", () => ({
  SidebarContent: () => null,
}));
vi.mock("../../modules/platform/components/sidebar/sidebar-header.js", () => ({
  SidebarHeader: () => null,
}));

const { Sidebar } =
  await import("../../modules/platform/components/sidebar/sidebar.js");

function renderSidebar(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(Sidebar)));
  return container;
}

const max = (viewport: number) =>
  sidebarMaxWidth({
    viewport,
    rightRailWidth: 60,
    contentMinWidth: MIN_CONTENT_WIDTH,
  });

it("stops the drag at the width the page can spare", () => {
  expect(max(1200)).toBe(1200 - 60 - MIN_CONTENT_WIDTH);
  expect(max(1280)).toBe(500);
  expect(max(700)).toBe(SIDEBAR_MIN_W);
});

it("keeps the navigation when the drag stays above the snap", () => {
  expect(snapSidebarWidth(SIDEBAR_MIN_W)).toBe(SIDEBAR_MIN_W);
  expect(snapSidebarWidth(210)).toBe(SIDEBAR_MIN_W);
  expect(snapSidebarWidth(300)).toBe(300);
});

it("gives up the navigation when the drag goes most of the way to the rail", () => {
  expect(snapSidebarWidth(SIDEBAR_COLLAPSED_W + 10)).toBe("rail");
  expect(snapSidebarWidth(120)).toBe("rail");
});

it("brings the navigation back at its narrowest coming out of the rail", () => {
  expect(snapSidebarWidth(140)).toBe(SIDEBAR_MIN_W);
  expect(snapSidebarWidth(SIDEBAR_MIN_W - 40)).toBe(SIDEBAR_MIN_W);
});

it("holds the navigation's own range", () => {
  expect(snapSidebarWidth(520)).toBe(520);
  expect(snapSidebarWidth(600)).toBe(520);
});

// TEST_SCENARIO: the navigation is expanded, so it draws its drag handle: the handle sits inside the navigation's own box, and the navigation is all the component draws, so no page beside it starts on a strip of empty background.
it("draws the resize handle inside the navigation, taking no room beside it", () => {
  const container = renderSidebar();
  const nav = container.querySelector('[data-testid="app-sidebar"]');
  const handle = container.querySelector('[data-testid="app-sidebar-resize"]');
  expect(handle).not.toBeNull();
  expect(nav?.contains(handle!)).toBe(true);
  expect(container.children).toHaveLength(1);
});
