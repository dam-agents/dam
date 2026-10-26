// @vitest-environment happy-dom
// TEST_OVERVIEW: The current layout's right edge: the approvals bell and the Get started ring sit in the page's own corner, and each opens its panel as a drawer over the page instead of a column beside it. The drawers follow the side panel's tab, so the same store tab opens them from the corner, from a phone's top bar and from the avatar picker, and closing one clears it.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  tab: null as string | null,
  setTab: (tab: string | null) => {
    fake.tab = tab;
  },
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
  "../../modules/getting-started/components/getting-started-panel.js",
  async () => {
    const { createElement } = await import("react");
    return {
      GettingStartedDrawer: ({ onClose }: { onClose: () => void }) =>
        createElement("button", {
          "data-testid": "getting-started-drawer",
          onClick: onClose,
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
});

// TEST_SCENARIO: the page's corner holds both entries in the page's own row, so a user without the experiments reaches Get started and Approvals from the page and the entries never cover its actions.
it("puts the ring and the bell in the page's own row", () => {
  const container = rendered(createElement(ClassicPageActions));
  const buttons = container.querySelector('[data-testid="panel-buttons"]');
  const row = container.firstElementChild;
  expect(buttons).not.toBeNull();
  expect(row?.contains(buttons!)).toBe(true);
  expect(row?.className).toContain("sticky");
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

// TEST_SCENARIO: the Get started tab opens the checklist drawer the same way.
it("opens the Get started drawer from its tab", () => {
  fake.tab = "getting-started";
  const container = rendered(createElement(ClassicPagePanels));
  expect(
    container.querySelector('[data-testid="getting-started-drawer"]'),
  ).not.toBeNull();
});

// TEST_SCENARIO: no tab of the drawers' kind means no overlay, as when a docked artifact is what the side panel holds.
it("draws nothing for a tab a drawer does not own", () => {
  fake.tab = "artifacts";
  const container = rendered(createElement(ClassicPagePanels));
  expect(container.innerHTML).toBe("");
});
