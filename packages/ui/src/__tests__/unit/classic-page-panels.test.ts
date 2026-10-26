// @vitest-environment happy-dom
// TEST_OVERVIEW: The current layout's right edge: the approvals bell and the Get started ring sit in the page's own corner. The bell opens Approvals as a drawer over the page instead of a column beside it, and the drawer follows the side panel's tab, so the same store tab opens it from the corner, from a phone's top bar and from the toast that announces an approval. Get started floats as its own dock, so it takes no page tab.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  tab: null as string | null,
  desktop: true,
  setTab: (tab: string | null) => {
    fake.tab = tab;
  },
}));

vi.mock("@/hooks/use-is-desktop", () => ({
  useIsDesktop: () => fake.desktop,
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({ sidePanelTab: fake.tab, setSidePanelTab: fake.setTab }),
}));
vi.mock("../../modules/home/components/approvals-panel.js", async () => {
  const { createElement } = await import("react");
  return {
    ApprovalsDrawer: ({ onClose }: { onClose: () => void }) =>
      createElement("button", {
        "data-testid": "approvals-drawer",
        onClick: onClose,
      }),
  };
});
vi.mock(
  "../../modules/getting-started/components/getting-started-dock.js",
  async () => {
    const { createElement } = await import("react");
    return {
      GettingStartedDock: ({ placement }: { placement: string }) =>
        createElement("div", {
          "data-testid": `getting-started-dock-${placement}`,
        }),
    };
  },
);
vi.mock("../../modules/sessions/components/app-side-panel.js", async () => {
  const { createElement } = await import("react");
  return {
    AppSidePanelButtons: () =>
      createElement("div", { "data-testid": "panel-buttons" }),
  };
});

const { ClassicPageActions, ClassicPagePanels } =
  await import("../../modules/platform/components/classic-page-panels.js");

function rendered(node: ReturnType<typeof createElement>): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return container;
}

beforeEach(() => {
  fake.tab = null;
  fake.desktop = true;
});

// TEST_SCENARIO: the page's corner keeps the bell in its own row, and the Get started ring floats under that row, out of its flow and aligned with the bell, so the row keeps no room for the ring and the page scrolls under it.
it("hangs the ring under the page's corner row", () => {
  const container = rendered(createElement(ClassicPageActions));
  const row = container.firstElementChild;
  expect(row?.className).toContain("sticky");
  expect(row?.querySelector('[data-testid="panel-buttons"]')).not.toBeNull();
  const dock = row?.querySelector(
    '[data-testid="getting-started-dock-corner"]',
  );
  expect(dock).not.toBeNull();
  const layer = dock?.parentElement;
  expect(layer?.className).toContain("absolute");
  expect(layer?.className).toContain("top-[46px]");
  expect(layer?.className).toContain("right-4");
  expect(layer?.className).toContain("md:right-6");
  expect(layer?.parentElement).toBe(row);
});

// TEST_SCENARIO: a phone's top bar carries the ring, so the page's corner mounts no dock there; two docks would share the open flag, and each would close the other on the next tap.
it("mounts no second dock on a phone", () => {
  fake.desktop = false;
  const container = rendered(createElement(ClassicPageActions));
  expect(
    container.querySelector('[data-testid="getting-started-dock-corner"]'),
  ).toBeNull();
  expect(
    container.querySelector('[data-testid="panel-buttons"]'),
  ).not.toBeNull();
});

// TEST_SCENARIO: the approvals tab opens the approvals drawer, and closing it clears the tab, so nothing is left open beside the page.
it("opens the approvals drawer from its tab", () => {
  fake.tab = "approvals";
  const container = rendered(createElement(ClassicPagePanels));
  const drawer = container.querySelector('[data-testid="approvals-drawer"]');
  expect(drawer).not.toBeNull();
  act(() => (drawer as HTMLElement).click());
  expect(fake.tab).toBe(null);
});

// TEST_SCENARIO: Get started is a dock of its own, so the page draws no overlay for it, and a docked artifact's tab draws none either.
it("draws no overlay for a tab a drawer does not own", () => {
  for (const tab of ["artifacts", null]) {
    fake.tab = tab;
    const container = rendered(createElement(ClassicPagePanels));
    expect(container.innerHTML).toBe("");
  }
});
