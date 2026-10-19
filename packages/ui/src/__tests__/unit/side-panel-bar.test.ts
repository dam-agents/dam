// TEST_OVERVIEW: The side panel's icon bar opens with a Close panel button at its top right while a tab is open, lists one button per visible tab, shows a count badge on a tab while it has one, such as the processes running now, keeps Get started and Approvals at its bottom, after the Agent's tabs, and outside an Agent's chat offers only Artifacts, Get started and Approvals.
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { createStore } from "zustand/vanilla";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import {
  type SidePanelBadge,
  SidePanelBar,
} from "../../modules/sessions/components/side-panel-bar.js";
import { hiddenSidePanelTabs } from "../../modules/sessions/lib/side-panel.js";
import { createSidePanelSlice } from "../../modules/sessions/store/side-panel.js";
import type { PlatformStore } from "../../store.js";

function render(processes?: SidePanelBadge) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelBar, {
        active: "files",
        hidden: new Set(["browser"] as const),
        onSelect: () => {},
        badges: processes ? { processes } : undefined,
      }),
    ),
  );
}

// TEST_SCENARIO: Get started and Approvals are tabs like the others, but they belong to every page, so they sit below the Agent's tabs, Get started above the bell, not between them.
it("renders the tabs of every page after the Agent's tabs", () => {
  const html = render();
  const order = ["processes", "getting-started", "approvals"].map((tab) =>
    html.indexOf(`data-testid="side-panel-tab-${tab}"`),
  );
  expect(order[0]).toBeGreaterThan(-1);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(html.indexOf("mt-auto")).toBeLessThan(order[1]!);
  expect(html).not.toContain('data-testid="side-panel-tab-browser"');
});

// TEST_SCENARIO: Waiting approvals keep the bell's warning colour, so the badge does not read as work in progress.
it("shows the waiting approvals in the warning colour", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelBar, {
        active: null,
        hidden: new Set<never>(),
        onSelect: () => {},
        badges: {
          approvals: {
            count: 3,
            label: "Approvals, 3 waiting",
            tone: "warning",
          },
        },
      }),
    ),
  );
  expect(html).toMatch(
    /class="[^"]*bg-warning[^"]*"[^>]*data-testid="side-panel-badge-approvals"[^>]*>3<\/span>/,
  );
  expect(html).toContain('aria-label="Approvals, 3 waiting"');
});

// TEST_SCENARIO: The "N running" indicator left the chat view's top-right corner; the Processes icon now carries the count, and names it for screen readers.
it("shows the running count on the processes tab", () => {
  const html = render({
    count: 2,
    label: "Processes, 2 running",
  });
  expect(html).toMatch(
    /data-testid="side-panel-badge-processes"[^>]*>2<\/span>/,
  );
  expect(html).toContain('aria-label="Processes, 2 running"');
});

// TEST_SCENARIO: Nothing runs: the icon is plain, so the badge only ever means work in progress.
it("shows no badge while the count is zero", () => {
  const html = render({ count: 0, label: "Processes, 0 running" });
  expect(html).not.toContain("side-panel-badge-");
  expect(html).toContain('aria-label="Processes"');
});

it("caps the count at 9+", () => {
  const html = render({ count: 12, label: "Processes, 12 running" });
  expect(html).toMatch(
    /data-testid="side-panel-badge-processes"[^>]*>9\+<\/span>/,
  );
});

// TEST_SCENARIO: The icon bar lists the views by how often users reach for them, Artifacts first.
it("orders the tabs Artifacts, Files, Changes, Browser", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelBar, {
        active: null,
        hidden: new Set<never>(),
        onSelect: () => {},
      }),
    ),
  );
  const order = ["artifacts", "files", "changes", "browser"].map((tab) =>
    html.indexOf(`data-testid="side-panel-tab-${tab}"`),
  );
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(order[0]).toBeGreaterThan(-1);
});

// TEST_SCENARIO: Home and every other page share the chat's icon bar, with Artifacts at the top beside Get started and Approvals at the bottom, and none of the Agent's tabs.
it("offers only the tabs that belong to no Agent outside a chat", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelBar, {
        active: null,
        hidden: hiddenSidePanelTabs({
          agent: false,
          canOpenBrowser: true,
          processesEnabled: true,
          gettingStarted: true,
        }),
        onSelect: () => {},
      }),
    ),
  );
  const tabs = [
    ...html.matchAll(/data-testid="side-panel-tab-([a-z-]+)"/g),
  ].map((m) => m[1]);
  expect(tabs).toEqual(["artifacts", "getting-started", "approvals"]);
});

// TEST_SCENARIO: The rail reads like an activity bar: 48 px square buttons with 24 px icons, and only the open tab carries the bar on its inner edge.
it("marks only the open tab with the inner-edge bar", () => {
  const html = render();
  const buttons = [
    ...html.matchAll(
      /<button[^>]*data-testid="side-panel-tab-([a-z-]+)"[^>]*>/g,
    ),
  ];
  expect(buttons.length).toBeGreaterThan(1);
  for (const [tag, tab] of buttons) {
    expect(tag).toContain("h-12 w-12");
    expect(tag.includes("before:bg-foreground")).toBe(tab === "files");
  }
  expect(html).toContain('width="24"');
});

// TEST_SCENARIO: In the new layout the rail matches the sidebar strip: 40 px rounded tiles with 20 px icons, only the open tab filled and carrying the bar on the rail's outer right edge, and Documentation as a tile between Get started and Approvals.
it("draws the new layout's tiles, with the bar on the right edge", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelBar, {
        active: "files",
        hidden: new Set(["browser"] as const),
        onSelect: () => {},
        tiles: true,
      }),
    ),
  );
  const buttons = [
    ...html.matchAll(
      /<button[^>]*data-testid="side-panel-tab-([a-z-]+)"[^>]*>(<span[^>]*><\/span>)/g,
    ),
  ];
  expect(buttons.length).toBeGreaterThan(1);
  for (const [, tab, bar] of buttons) {
    expect(bar).toContain("-right-2.5");
    expect(bar.includes(" h-6")).toBe(tab === "files");
  }
  const open = buttons.find(([, tab]) => tab === "files")![0];
  expect(open).toContain("size-10");
  expect(open).toContain("bg-muted");
  expect(html).toContain('width="20"');
  const order = ["getting-started", "docs", "approvals"].map((id) =>
    html.indexOf(
      id === "docs"
        ? 'data-testid="side-panel-docs"'
        : `data-testid="side-panel-tab-${id}"`,
    ),
  );
  expect(order[1]).toBeGreaterThan(order[0]!);
  expect(order[2]).toBeGreaterThan(order[1]!);
});

function findByTestId(
  node: ReactNode,
  id: string,
): { onClick: () => void } | null {
  for (const child of Children.toArray(node)) {
    if (
      !isValidElement<{
        children?: ReactNode;
        "data-testid"?: string;
        onClick: () => void;
      }>(child)
    )
      continue;
    if (child.props["data-testid"] === id) return child.props;
    const found = findByTestId(child.props.children, id);
    if (found) return found;
  }
  return null;
}

// TEST_SCENARIO: The X at the top right of an open panel closes it, in both layouts, without hunting for the active tab's icon.
it.each([false, true])(
  "closes the open panel from its X (tiles: %s)",
  (tiles) => {
    const store = createStore<PlatformStore>()(
      (...a) => createSidePanelSlice(...a) as PlatformStore,
    );
    store.getState().setSidePanelTab("approvals");
    const props = {
      active: store.getState().sidePanelTab,
      hidden: new Set<never>(),
      onSelect: () => {},
      onClose: () => store.getState().setSidePanelTab(null),
      tiles,
    };
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(SidePanelBar, props)),
    );
    expect(html).toMatch(
      /<button[^>]*aria-label="Close panel"[^>]*data-testid="side-panel-close"/,
    );
    expect(html.indexOf("side-panel-close")).toBeLessThan(
      html.indexOf("side-panel-tab-"),
    );
    findByTestId(SidePanelBar(props), "side-panel-close")!.onClick();
    expect(store.getState().sidePanelTab).toBeNull();
  },
);

// TEST_SCENARIO: A closed panel keeps the X's slot but hides it, so the tab icons do not move when the panel opens.
it("hides the X while the panel is closed", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelBar, {
        active: null,
        hidden: new Set<never>(),
        onSelect: () => {},
        onClose: () => {},
      }),
    ),
  );
  expect(html).toMatch(
    /<button[^>]*class="[^"]*invisible[^"]*"[^>]*data-testid="side-panel-close"/,
  );
});
