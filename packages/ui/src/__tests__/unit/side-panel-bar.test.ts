// TEST_OVERVIEW: The side panel's icon bar lists one button per visible tab, shows a count badge on a tab while it has one, such as the processes running now, and holds a footer, such as the approvals bell, at its bottom, after the tabs.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import {
  type SidePanelBadge,
  SidePanelBar,
} from "../../modules/sessions/components/side-panel-bar.js";

function render(footer?: string, processes?: SidePanelBadge) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelBar, {
        active: "files",
        hidden: new Set(["browser"] as const),
        onSelect: () => {},
        badges: processes ? { processes } : undefined,
        footer:
          footer === undefined
            ? undefined
            : createElement("button", { "data-testid": footer }),
      }),
    ),
  );
}

// TEST_SCENARIO: The chat view moved the approvals bell from a floating corner into the icon bar; it must sit below every tab, not between them.
it("renders the footer after the last tab", () => {
  const html = render("open-approvals");
  const footer = html.indexOf('data-testid="open-approvals"');
  expect(footer).toBeGreaterThan(-1);
  expect(footer).toBeGreaterThan(
    html.indexOf('data-testid="side-panel-tab-processes"'),
  );
  expect(html.indexOf("</nav>")).toBeGreaterThan(footer);
});

it("renders no footer slot without a footer", () => {
  const html = render();
  expect(html).not.toContain("mt-auto");
  expect(html).not.toContain('data-testid="side-panel-tab-browser"');
});

// TEST_SCENARIO: The "N running" indicator left the chat view's top-right corner; the Processes icon now carries the count, and names it for screen readers.
it("shows the running count on the processes tab", () => {
  const html = render(undefined, {
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
  const html = render(undefined, { count: 0, label: "Processes, 0 running" });
  expect(html).not.toContain("side-panel-badge-");
  expect(html).toContain('aria-label="Processes"');
});

it("caps the count at 9+", () => {
  const html = render(undefined, { count: 12, label: "Processes, 12 running" });
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
