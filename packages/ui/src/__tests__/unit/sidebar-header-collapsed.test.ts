// @vitest-environment happy-dom
// TEST_OVERVIEW: The header of the navigation rail. Collapsed, the rail shows the brand where the icons below it sit — the brand's own 16px slot, padded like a nav item and centred in it — so the wordmark and the Home icon share one column whatever the brand's width; expanded, the wordmark stays on the left and the toggle on the right, and the brand button is padded so the wordmark's box starts on the same column's left edge.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { getBrand } = await import("../../brand.js");
const { SidebarHeader } =
  await import("../../modules/platform/components/sidebar/sidebar-header.js");

let root: Root | undefined;
let container: HTMLElement | undefined;

function render(expanded: boolean) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(
        TooltipProvider,
        null,
        createElement(SidebarHeader, {
          expanded,
          onToggle: () => {},
          onHome: () => {},
        }),
      ),
    ),
  );
}

const toggle = (label = "Expand navigation") =>
  document.querySelector<HTMLElement>(`[aria-label="${label}"]`);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});

// TEST_SCENARIO: the brand sits in the nav items' own 16px icon column, so its centre is the Home icon's centre and not the rail's.
it("centres the brand on the icon column", () => {
  render(false);
  const button = toggle();
  expect(button?.className).toContain("pl-2.5");
  const slot = button?.querySelector("span");
  expect(slot?.className).toContain("size-4");
  expect(slot?.className).toContain("justify-center");
  expect(button?.querySelector("svg")?.getAttribute("class")).toContain(
    "shrink-0",
  );
});

// TEST_SCENARIO: the expanded header keeps the wordmark on the left and the toggle after it, with the brand button padded so the logo's box starts at the icon column's left edge: the rail's 8px plus 2px, which centres the 32px logo on the icons' 26px column.
it("leaves the expanded header alone", () => {
  render(true);
  const button = toggle("Collapse navigation");
  expect(button?.className).toContain("p-1.5");
  expect(button?.querySelector("span")).toBeNull();
  const brand = document.querySelector<HTMLElement>(
    `[aria-label="${getBrand().name}"]`,
  );
  expect(brand?.className).toContain("px-0.5");
  expect(brand?.className).toContain("py-1");
});
