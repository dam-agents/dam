// TEST_OVERVIEW: The side panel's icon bar lists one button per visible tab, and holds a footer, such as the approvals bell, at its bottom, after the tabs.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { SidePanelBar } from "../../modules/sessions/components/side-panel-bar.js";

function render(footer?: string) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelBar, {
        active: "files",
        hidden: new Set(["browser"] as const),
        onSelect: () => {},
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
