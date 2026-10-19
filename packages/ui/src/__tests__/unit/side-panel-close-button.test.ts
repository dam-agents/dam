// TEST_OVERVIEW: Every side panel's top bar ends with a Close panel X, after the panel's own actions and behind a vertical border; clicking it closes the whole panel, or runs the panel's own close when it brings one, and hands focus to the rail's open tab.
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { SidePanelCloseButton } from "../../modules/sessions/components/side-panel-close-button.js";
import { SidebarSection } from "../../modules/sessions/components/sidebar-section.js";
import { createSidePanelSlice } from "../../modules/sessions/store/side-panel.js";
import type { PlatformStore } from "../../store.js";

const store = vi.hoisted(() => ({
  current: null as unknown as { getState: () => PlatformStore },
}));
vi.mock("../../store.js", () => ({
  useStore: { getState: () => store.current.getState() },
}));
store.current = createStore<PlatformStore>()(
  (...a) => createSidePanelSlice(...a) as PlatformStore,
);

type Click = (e: {
  currentTarget: { closest: (s: string) => unknown };
}) => void;

const outsidePanel = { currentTarget: { closest: () => null } };

function closeButton(node: ReactNode): { onClick: Click } {
  for (const child of Children.toArray(node)) {
    if (
      !isValidElement<{
        children?: ReactNode;
        "data-testid"?: string;
        onClick: Click;
      }>(child)
    )
      continue;
    if (child.props["data-testid"] === "side-panel-close") return child.props;
    try {
      return closeButton(child.props.children);
    } catch {
      continue;
    }
  }
  throw new Error("no close button");
}

// TEST_SCENARIO: The X is the last item of a panel's top bar, after the panel's own buttons, with a border between them.
it("ends the panel's top bar with the X, behind a border", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidebarSection, {
        title: "Files",
        open: true,
        headerRight: createElement("button", { id: "own-action" }),
        children: null,
      }),
    ),
  );
  expect(html).toMatch(
    /id="own-action"><\/button><div class="[^"]*border-l[^"]*"><button[^>]*aria-label="Close panel"[^>]*data-testid="side-panel-close"/,
  );
});

// TEST_SCENARIO: Clicking the X closes the open panel.
it("closes the side panel", () => {
  store.current.getState().setSidePanelTab("approvals");
  closeButton(SidePanelCloseButton({})).onClick(outsidePanel);
  expect(store.current.getState().sidePanelTab).toBeNull();
});

// TEST_SCENARIO: A panel with its own way to close, such as a delegation, which clears what it shows, keeps it behind the X.
it("runs the panel's own close when it brings one", () => {
  let closed = false;
  closeButton(
    SidePanelCloseButton({
      onClose: () => {
        closed = true;
      },
    }),
  ).onClick(outsidePanel);
  expect(closed).toBe(true);
});

// TEST_SCENARIO: The X unmounts with the panel, so focus moves to the open tab's rail button first, not to the page start; with no open tab in the rail, such as a delegation, the rail's first button takes it.
it.each([
  ["the open tab", true, "open-tab"],
  ["the rail's first button", false, "first-button"],
])("hands focus to %s", (_, pressed, expected) => {
  const focused: string[] = [];
  const button = (id: string) => ({ focus: () => focused.push(id) });
  const bar = {
    querySelector: (s: string) =>
      s === '[aria-pressed="true"]'
        ? pressed
          ? button("open-tab")
          : null
        : button("first-button"),
  };
  const panel = {
    querySelector: (s: string) =>
      s === '[data-testid="side-panel-bar"]' ? bar : null,
  };
  closeButton(SidePanelCloseButton({ onClose: () => {} })).onClick({
    currentTarget: {
      closest: (s) => (s === '[data-testid="side-panel"]' ? panel : null),
    },
  });
  expect(focused).toEqual([expected]);
});
