// TEST_OVERVIEW: The sidebar's Home, Artifacts and Starter kits entries behave alike: each opens its own page and shows as current while that page is shown, rather than one opening a page, one a side panel and one a dialog.
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  view: "home",
  setView: vi.fn(),
  navigateToSettings: vi.fn(),
}));

vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => false,
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

it.each([
  ["home", "Home"],
  ["artifacts", "Artifacts"],
  ["starter-kits", "Starter kits"],
])("TEST_SCENARIO: on the %s page, only %s is current", (view, label) => {
  state.view = view;
  expect(
    useSidebarDestinations()
      .primary.filter((d) => d.active)
      .map((d) => d.label),
  ).toEqual([label]);
});
