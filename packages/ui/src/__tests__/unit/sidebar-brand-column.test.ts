// @vitest-environment happy-dom
// TEST_OVERVIEW: Where the brand sits in a navigation header. The rail's icons sit on one column 26px from the rail's edge, and the brand sits on it too: the collapsed rail, the expanded rail and the phone drawer each put the logo in one fixed-size slot padded like a nav item. The logo keeps its own width and overflows that slot evenly, so the column holds whatever width the brand's wordmark has.
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../modules/platform/components/sidebar/sidebar-content.js", () => ({
  SidebarContent: () => null,
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (state: unknown) => unknown) =>
    select({ mobileNavOpen: true, setMobileNavOpen: () => {} }),
}));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { SidebarHeader } =
  await import("../../modules/platform/components/sidebar/sidebar-header.js");
const { MobileNavDrawer } =
  await import("../../modules/platform/components/sidebar/mobile-nav-drawer.js");

const SLOT = [
  "flex",
  "items-center",
  "justify-center",
  "relative",
  "shrink-0",
  "size-4",
];

let root: Root | undefined;

function render(element: ReactElement) {
  if (root) act(() => root?.unmount());
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(TooltipProvider, null, element)));
}

function classes(element: Element | null | undefined): string[] {
  return (element?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

const header = (expanded: boolean) =>
  createElement(SidebarHeader, {
    expanded,
    onToggle: () => {},
    onHome: () => {},
  });

const buttons = () => [...document.querySelectorAll<HTMLElement>("button")];

function slot(): string[] {
  const logo = [...document.querySelectorAll("svg")].find(
    (svg) => svg.parentElement?.tagName === "SPAN",
  );
  return classes(logo?.parentElement).sort();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

// TEST_SCENARIO: the collapsed rail shows the brand where the icons below it sit, in the same slot a nav item's icon gets, so the wordmark's centre is the Home icon's centre and not the rail's.
it("puts the brand on the icon column of the collapsed rail", () => {
  render(header(false));
  const [toggle] = buttons();
  expect(classes(toggle).sort()).toContain("pl-2.5");
  expect(classes(toggle).sort()).toContain("h-10");
  expect(slot()).toEqual(SLOT);
});

// TEST_SCENARIO: the expanded rail keeps the wordmark on the left and the toggle after it, and the brand button is a 40px box whose padding is the nav item's, so the logo's slot starts on the icon column; the button's own box stays large enough to hold the overflowing logo, so the hover background covers what it highlights.
it("puts the brand on the icon column of the expanded rail", () => {
  render(header(true));
  const [brand] = buttons();
  const brandClasses = classes(brand).sort();
  expect(brandClasses).toContain("h-10");
  expect(brandClasses).toContain("px-2.5");
  expect(brandClasses).not.toContain("py-1");
  expect(brandClasses).not.toContain("p-1");
  expect(slot()).toEqual(SLOT);
});

// TEST_SCENARIO: the phone drawer repeats the rail's header inside the drawer's own 8px padding, so its wordmark lands on the same column as the drawer's nav icons.
it("puts the brand on the icon column of the phone drawer", () => {
  render(createElement(MobileNavDrawer));
  const row = document.querySelector<HTMLElement>(
    "[data-testid='mobile-nav']",
  )?.previousElementSibling;
  expect(classes(row).sort()).toContain("pl-2.5");
  expect(slot()).toEqual(SLOT);
});
