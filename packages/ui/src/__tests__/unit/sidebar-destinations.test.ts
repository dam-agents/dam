// TEST_OVERVIEW: The sidebar's Home, Artifacts and Starter kits entries behave alike: each opens its own page and shows as current while that page is shown, rather than one opening a page, one a side panel and one a dialog. The Unified right toolbar puts Artifacts and Documentation on every page's rail, so with it on the navigation drops its own entries for both.
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  view: "home",
  rightToolbar: false,
  setView: vi.fn(),
  navigateToSettings: vi.fn(),
}));

vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => false,
}));
vi.mock("../../modules/features/hooks/use-unified-right-toolbar.js", () => ({
  useUnifiedRightToolbar: () => state.rightToolbar,
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: typeof state) => unknown) => select(state),
}));

const { useSidebarDestinations } =
  await import("../../modules/platform/hooks/use-sidebar-destinations.js");

it("TEST_SCENARIO: Home, Artifacts and Starter kits each open their own page", () => {
  const [home, artifacts, kits] = useSidebarDestinations().primary;
  home!.navigate();
  artifacts!.navigate();
  kits!.navigate();
  expect(state.setView.mock.calls).toEqual([
    ["home"],
    ["artifacts"],
    ["starter-kits"],
  ]);
});

beforeEach(() => {
  state.rightToolbar = false;
  state.view = "home";
  vi.clearAllMocks();
});

// TEST_SCENARIO: with the Unified right toolbar on, the navigation leaves Artifacts out, because every page's rail already offers it, and keeps Documentation, because the rail shows no docs surface at all.
it("leaves Artifacts out while the right toolbar offers it", () => {
  state.rightToolbar = true;
  const { primary, secondary } = useSidebarDestinations();
  expect(primary.map((d) => d.label)).toEqual(["Home", "Starter kits"]);
  expect(secondary.map((d) => d.label)).toEqual(["Documentation", "Settings"]);
});

it.each([
  ["home", "Home"],
  ["artifacts", "Artifacts"],
  ["starter-kits", "Starter kits"],
  ["starter-kit", "Starter kits"],
])("TEST_SCENARIO: on the %s page, only %s is current", (view, label) => {
  state.view = view;
  expect(
    useSidebarDestinations()
      .primary.filter((d) => d.active)
      .map((d) => d.label),
  ).toEqual([label]);
});
