// TEST_OVERVIEW: Every side panel's top bar ends with a Close panel X, after the panel's own actions and behind a vertical border; clicking it closes the whole panel, or runs the panel's own close when it brings one, and hands focus to the rail's open tab, or with no rail to the top bar's open tab or the main region. Where clearing the tab closes nothing, only a panel with its own close shows it.
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { RightToolbarTiles } from "../../modules/sessions/components/right-toolbar-tiles.js";
import {
  PanelCloseButton,
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

function closeCellClasses(html: string): string[] {
  const cell = html.match(
    /<div class="([^"]*)"><button[^>]*data-testid="side-panel-close"/,
  )?.[1];
  if (cell === undefined) throw new Error("no close cell");
  return cell.split(" ");
}

// TEST_SCENARIO: With the Unified right toolbar experiment on, the panel's header sits on the first rail tile's row, 40 high and 8 below the top with its rule under it and none above; the X's cell reaches up through those 8 px and out through the header's 8 px of right padding, 48 wide with its border and 47 high above the rule, so the 40 square X closes and hands the keyboard back like the small button, centered in a 47 px square, without JanUI being on.
it("draws the unified right toolbar's header on the rail's row with a tile X", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(
        RightToolbarTiles.Provider,
        { value: true },
        createElement(SidebarSection, {
          title: "Files",
          open: true,
          headerClassName: "border-t border-border",
          children: null,
        }),
      ),
    ),
  );
  const headerClass =
    html.match(/class="([^"]*mt-2[^"]*h-10[^"]*)"/)?.[1] ?? "";
  expect(headerClass.split(" ")).toContain("border-b");
  expect(headerClass.split(" ")).not.toContain("border-t");
  const closeTag =
    html.match(/<button[^>]*data-testid="side-panel-close"[^>]*>/)?.[0] ?? "";
  expect(closeTag).toContain("size-10");
  expect(closeTag).toContain("[corner-shape:squircle]");
  const cell = closeCellClasses(html);
  expect(cell).toEqual(
    expect.arrayContaining([
      "-mt-2",
      "-mr-2",
      "w-12",
      "h-[47px]",
      "items-center",
      "justify-center",
    ]),
  );
  expect(cell).not.toContain("pt-2");
  store.current.getState().setSidePanelTab("approvals");
  closeButton(PanelCloseButton({ tiles: true })).onClick(outsidePanel);
  expect(store.current.getState().sidePanelTab).toBeNull();
});

// TEST_SCENARIO: A docked panel's header starts at the panel's top and pads its row on the right, so its X's cell takes the same 47 px square from the corner its header names, and the classic X ignores that corner and keeps its 8 px of padding.
it.each([
  [
    "the tiled X",
    true,
    ["-mr-4", "w-12", "h-[47px]", "self-start"],
    ["pl-2", "-mt-2"],
  ],
  [
    "the classic X",
    false,
    ["pl-2", "self-stretch"],
    ["-mr-4", "w-12", "h-[47px]"],
  ],
])(
  "in a docked panel's header, %s takes its cell from the header's corner",
  (_, tiles, has, lacks) => {
    const cell = closeCellClasses(
      renderToStaticMarkup(
        createElement(
          TooltipProvider,
          null,
          PanelCloseButton({ tiles, corner: "-mr-4" }),
        ),
      ),
    );
    expect(cell).toEqual(expect.arrayContaining(has));
    for (const c of lacks) expect(cell).not.toContain(c);
  },
);

// TEST_SCENARIO: The X is the last item of a panel's top bar, after the panel's own buttons, with a border between them; a panel outside the shell's provider, such as the classic chat's column, keeps the classic 48 px header and its rule.
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
  const headerClass = html.match(/class="([^"]*h-12[^"]*)"/)?.[1] ?? "";
  expect(headerClass.split(" ")).toContain("border-b");
});

// TEST_SCENARIO: A phone hides the X, because the full-screen panel there has its own back button, except where the panel keeps a top bar with the X instead, which the Unified right toolbar experiment draws.
it.each([
  ["the tiled panel", true, false],
  ["the classic column", false, true],
])("in %s the X is hidden on a phone: %s", (_, tiles, hidden) => {
  const html = renderToStaticMarkup(
    createElement(TooltipProvider, null, PanelCloseButton({ tiles })),
  );
  expect(closeCellClasses(html).includes("max-md:hidden")).toBe(hidden);
});

// TEST_SCENARIO: The X names itself for screen readers and carries no tooltip, in the tiled panel and in the classic column alike.
it("names the X without a tooltip", () => {
  for (const tiles of [true, false]) {
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, null, PanelCloseButton({ tiles })),
    );
    const button =
      html.match(
        /<button[^>]*aria-label="Close panel"[^>]*data-testid="side-panel-close"[^>]*>/,
      )?.[0] ?? "";
    expect(button).toContain('aria-label="Close panel"');
    expect(button).not.toContain("data-state=");
  }
});

// TEST_SCENARIO: Clicking the X closes the open panel.
it("closes the side panel", () => {
  store.current.getState().setSidePanelTab("approvals");
  closeButton(PanelCloseButton({ tiles: false })).onClick(outsidePanel);
  expect(store.current.getState().sidePanelTab).toBeNull();
});

// TEST_SCENARIO: A panel with its own way to close, such as a delegation, which clears what it shows, keeps it behind the X.
it("runs the panel's own close when it brings one", () => {
  let closed = false;
  closeButton(
    PanelCloseButton({
      tiles: false,
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
  closeButton(PanelCloseButton({ tiles: false, onClose: () => {} })).onClick({
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
        createElement(SidePanelCloseButton, { corner: "-mr-4", ...props }),
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
  closeButton(PanelCloseButton({ tiles: false, onClose: () => {} })).onClick({
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
