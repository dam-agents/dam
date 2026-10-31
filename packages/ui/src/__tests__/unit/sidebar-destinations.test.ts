// TEST_OVERVIEW: The sidebar's Home, Artifacts and Starter kits entries behave alike: each opens its own page and shows as current while that page is shown, rather than one opening a page, one a side panel and one a dialog.
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  view: "home",
  setView: vi.fn(),
  navigateToSettings: vi.fn(),
}));

vi.mock(
  "../../modules/links/api/queries.js",
  () => import("./support/fake-links.js"),
);
vi.mock("../../store.js", () => ({
  useStore: (select: (s: typeof state) => unknown) => select(state),
}));

const { CHART_DEFAULT_LINKS, fakeLinks } =
  await import("./support/fake-links.js");
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
  state.view = "home";
  fakeLinks.current = { ...CHART_DEFAULT_LINKS };
  vi.clearAllMocks();
});

// TEST_SCENARIO: an install that sets no documentation site has no Documentation entry, rather than one that opens nothing.
it("leaves Documentation out when the install sets no documentation site", () => {
  fakeLinks.current = { ...CHART_DEFAULT_LINKS, docs: null };
  expect(useSidebarDestinations().secondary.map((d) => d.label)).toEqual([
    "Settings",
  ]);
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
