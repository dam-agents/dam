// @vitest-environment happy-dom
// TEST_OVERVIEW: an open side panel leaves the sidebar as the user set it. On a narrow window, with a side panel such as Files open, an expanded sidebar keeps its labels, and a collapsed one stays a rail.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = {
  sidebarExpanded: true,
  setSidebarExpanded: vi.fn(),
  sidePanelTab: "files" as string | null,
  view: "agent",
};

vi.mock("../../store.js", () => ({
  useStore: (select: (s: typeof state) => unknown) => select(state),
}));
vi.mock("../../modules/platform/components/sidebar/sidebar-content.js", () => ({
  SidebarContent: () => createElement("div", { "data-testid": "labels" }),
}));
vi.mock("../../modules/platform/components/sidebar/sidebar-header.js", () => ({
  SidebarHeader: () => null,
}));
vi.mock("../../modules/platform/hooks/use-sidebar-destinations.js", () => ({
  useSidebarDestinations: () => ({
    home: { navigate: () => {} },
    primary: [],
    secondary: [],
  }),
}));
vi.mock("../../modules/home/hooks/use-activity-sessions.js", () => ({
  useActivitySessions: () => ({ items: [] }),
}));
vi.mock(
  "../../modules/getting-started/components/getting-started-nav-item.js",
  () => ({ GettingStartedNavItem: () => null }),
);
vi.mock("../../modules/platform/components/sidebar/sidebar-flyout.js", () => ({
  SidebarFlyout: () => null,
}));

const { Sidebar } =
  await import("../../modules/platform/components/sidebar/sidebar.js");

let root: Root | undefined;

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Sidebar)));
}

const nav = () =>
  document.querySelector<HTMLElement>('[data-testid="app-sidebar"]');
const labels = () => document.querySelector('[data-testid="labels"]');

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MediaQueryList);
  window.localStorage.clear();
  state.sidePanelTab = "files";
  state.view = "agent";
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// TEST_SCENARIO: a user with the sidebar expanded opens Files on a 900 px window, and the sidebar still shows the navigation with its labels.
it("keeps an expanded sidebar expanded while a side panel is open on a narrow window", () => {
  state.sidebarExpanded = true;
  render();
  expect(labels()).not.toBeNull();
  expect(nav()?.style.width).not.toBe("56px");
});

// TEST_SCENARIO: a user who collapsed the sidebar opens Files, and the sidebar stays the icon rail.
it("keeps a collapsed sidebar collapsed while a side panel is open", () => {
  state.sidebarExpanded = false;
  render();
  expect(labels()).toBeNull();
  expect(nav()?.style.width).toBe("56px");
});
