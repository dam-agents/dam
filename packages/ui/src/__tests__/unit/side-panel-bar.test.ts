// TEST_OVERVIEW: The side panel's icon bar lists one button per visible tab, shows a count badge on a tab while it has one, such as the processes running now, keeps Get started and Approvals at its bottom, after the Agent's tabs, and outside an Agent's chat offers only Artifacts, Get started and Approvals. The tiled rail's Artifacts tile draws the document icon whatever shell the page has, while the classic buttons keep the layout's own artifact icon.
import { DocumentAttachment } from "@carbon/icons-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ArtifactIcon } from "../../modules/artifacts/lib/artifact-icon.js";
import {
  SIDE_PANEL_TABS,
  type SidePanelBadge,
  SidePanelBar,
} from "../../modules/sessions/components/side-panel-bar.js";
import { hiddenSidePanelTabs } from "../../modules/sessions/lib/side-panel.js";

vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => true,
}));

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

// TEST_SCENARIO: An Agent's configuration keeps a tab of its own beside the chat, so Connections, Channels, Skills and Schedules open without leaving the conversation; each tab shows its own name, above the tabs that belong to every page.
it("lists the Agent's configuration tabs", () => {
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
  for (const [tab, label] of [
    ["connections", "Connections"],
    ["channels", "Channels"],
    ["skills", "Skills"],
    ["schedules", "Schedules"],
  ] as const) {
    expect(html).toContain(`data-testid="side-panel-tab-${tab}"`);
    expect(html).toContain(`aria-label="${label}"`);
  }
  const order = [
    "processes",
    "connections",
    "channels",
    "skills",
    "schedules",
    "getting-started",
  ].map((tab) => html.indexOf(`data-testid="side-panel-tab-${tab}"`));
  expect(order[0]).toBeGreaterThan(-1);
  expect(order).toEqual([...order].sort((a, b) => a - b));
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

// TEST_SCENARIO: Home and every other page outside an Agent share the chat's icon bar with only Get started and Approvals: no Agent tab, and no Artifacts, which has its own page.
it("offers only the tabs that belong to no Agent outside a chat", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelBar, {
        active: null,
        hidden: hiddenSidePanelTabs({
          agent: false,
          artifacts: false,
          canOpenBrowser: true,
          changes: false,
          processesEnabled: true,
          environments: true,
          configuration: false,
          gettingStarted: true,
        }),
        onSelect: () => {},
      }),
    ),
  );
  const tabs = [
    ...html.matchAll(/data-testid="side-panel-tab-([a-z-]+)"/g),
  ].map((m) => m[1]);
  expect(tabs).toEqual(["getting-started", "approvals"]);
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

// TEST_SCENARIO: The rail holds the Agent's tabs at the top and the app's tabs at the bottom, which needs about 380 px; a landscape phone can be shorter, so the rail scrolls like the sidebar rail instead of putting the bottom tabs below the screen.
it("scrolls the rail when the window cannot hold both clusters", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelBar, {
        active: null,
        hidden: new Set<never>(),
        onSelect: () => {},
        tiles: true,
      }),
    ),
  );
  const nav = html.match(/<nav[^>]*data-testid="side-panel-bar"[^>]*>/)?.[0];
  expect(nav).toContain("min-h-0");
  expect(nav).toContain("overflow-y-auto");
});

// TEST_SCENARIO: In JanUI the rail matches the sidebar strip: 40 px rounded tiles with 22 px icons, only the open tab filled, no separate bar because the fill is the mark, and Documentation as a tile between Get started and Approvals.
it("draws JanUI's tiles at the sidebar strip's size", () => {
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
      /<button[^>]*data-testid="side-panel-tab-([a-z-]+)"[^>]*>/g,
    ),
  ];
  expect(buttons.length).toBeGreaterThan(1);
  expect(html).not.toContain("-right-2.5");
  const open = buttons.find(([, tab]) => tab === "files")![0];
  // UNIT_BOUNDARY_DESCRIPTION: the tile is one row high and as wide, so the mark it carries is a square of the same size a row of the tree carries.
  expect(open).toContain("size-10");
  expect(open).toContain("bg-muted");
  expect(html).toContain('width="22"');
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

// TEST_SCENARIO: The JanUI rail names a tab through its aria-label and the panel header, not a hover tooltip that would cover the panel, as the left rail does; the classic layout's icon bar keeps its tooltip.
it("drops the rail's tooltips but keeps the classic bar's", () => {
  const railHtml = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelBar, {
        active: null,
        hidden: new Set<never>(),
        onSelect: () => {},
        tiles: true,
      }),
    ),
  );
  const tile =
    railHtml.match(
      /<button[^>]*data-testid="side-panel-tab-artifacts"[^>]*>/,
    )?.[0] ?? "";
  expect(tile).toContain('aria-label="Artifacts"');
  expect(tile).not.toContain("data-state=");
  const classicHtml = renderToStaticMarkup(
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
  const classic =
    classicHtml.match(
      /<button[^>]*data-testid="side-panel-tab-artifacts"[^>]*>/,
    )?.[0] ?? "";
  expect(classic).toContain('data-state="closed"');
});

// TEST_SCENARIO: the tiled rail draws artifacts as the document icon whatever shell the page has, while the classic buttons and the rest of the app keep the layout's own artifact icon, so a page with the flag off draws what it always did.
it("draws artifacts as the document icon on the rail alone", () => {
  const artifacts = SIDE_PANEL_TABS.find((t) => t.tab === "artifacts");
  expect(artifacts?.tileIcon).toBe(DocumentAttachment);
  expect(artifacts?.icon).toBe(ArtifactIcon);
});
