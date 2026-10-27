// TEST_OVERVIEW: The side panel's icon bar lists one button per visible tab, shows a count badge on a tab while it has one, such as the processes running now, keeps Approvals at its bottom, after the Agent's tabs, and outside an Agent's chat offers only Approvals.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import {
  type SidePanelBadge,
  SidePanelBar,
} from "../../modules/sessions/components/side-panel-bar.js";
import { hiddenSidePanelTabs } from "../../modules/sessions/lib/side-panel.js";

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

// TEST_SCENARIO: Approvals is a tab like the others, but it belongs to every page, so it sits below the Agent's tabs instead of between them.
it("renders the tabs of every page after the Agent's tabs", () => {
  const html = render();
  const order = ["processes", "approvals"].map((tab) =>
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

// TEST_SCENARIO: Home and every other page outside an Agent share the chat's icon bar with only Approvals: no Agent tab, and no Artifacts, which has its own page.
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
        }),
        onSelect: () => {},
      }),
    ),
  );
  const tabs = [
    ...html.matchAll(/data-testid="side-panel-tab-([a-z-]+)"/g),
  ].map((m) => m[1]);
  expect(tabs).toEqual(["approvals"]);
});

// TEST_SCENARIO: The bar reads like an activity bar: 48 px square buttons with 24 px icons, and only the open tab carries the bar on its inner edge.
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

// TEST_SCENARIO: Every bar names each tab in a hover tooltip and in its aria-label, so a reader can find a panel from its glyph alone.
it("names every panel in a tooltip", () => {
  const html = render();
  const button =
    html.match(
      /<button[^>]*data-testid="side-panel-tab-artifacts"[^>]*>/,
    )?.[0] ?? "";
  expect(button).toContain('aria-label="Artifacts"');
  expect(button).toContain('data-state="closed"');
});
