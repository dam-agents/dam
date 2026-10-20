// TEST_OVERVIEW: Every side panel's top bar ends with a Close panel X, after the panel's own actions and behind a vertical border; clicking it closes the whole panel, or runs the panel's own close when it brings one, and hands focus to the rail's open tab, or with no rail to the top bar's open tab or the main region. Where clearing the tab closes nothing, only a panel with its own close shows it.
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import {
  SidePanelCloseButton,
  SidePanelCloseScope,
} from "../../modules/sessions/components/side-panel-close-button.js";
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
  currentTarget: {
    closest: (s: string) => unknown;
    ownerDocument?: {
      querySelector: (s: string) => unknown;
      getElementById: (id: string) => unknown;
    };
  };
}) => void;

const noPage = { querySelector: () => null, getElementById: () => null };
const outsidePanel = {
  currentTarget: { closest: () => null, ownerDocument: noPage },
};

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

// TEST_SCENARIO: Where clearing the side-panel tab closes nothing, such as the classic chat's sections, a section header shows no X; a panel that brings its own close, such as a delegation, keeps it.
it.each([
  ["a section header", {}, false],
  ["a panel with its own close", { onClose: () => {} }, true],
])("in a scope that closes no side panel, %s", (_, props, shown) => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(
        SidePanelCloseScope,
        { value: false },
        createElement(SidePanelCloseButton, props),
      ),
    ),
  );
  expect(html.includes('data-testid="side-panel-close"')).toBe(shown);
});

// TEST_SCENARIO: With no rail around the panel, as in the classic chat, focus goes to the top bar's open tab, or to the main region when no tab is open, such as for a delegation.
it.each([
  ["the top bar's open tab", true, "top-bar-tab"],
  ["the main region", false, "main"],
])("with no rail, hands focus to %s", (_, pressed, expected) => {
  const focused: string[] = [];
  const button = (id: string) => ({ focus: () => focused.push(id) });
  closeButton(SidePanelCloseButton({ onClose: () => {} })).onClick({
    currentTarget: {
      closest: () => null,
      ownerDocument: {
        querySelector: (s) =>
          pressed && s.includes("side-panel-tab-")
            ? button("top-bar-tab")
            : null,
        getElementById: (id) => (id === "main" ? button("main") : null),
      },
    },
  });
  expect(focused).toEqual([expected]);
});
