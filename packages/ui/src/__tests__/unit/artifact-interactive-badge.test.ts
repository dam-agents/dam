// TEST_OVERVIEW: The Interactive badge fits the 16 px chip line of an artifact row, which clips what is taller, so it shows whole beside the deletion chip and the view count.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ArtifactInteractiveBadge } from "../../modules/artifacts/components/artifact-badges.js";

function badgeClasses() {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(ArtifactInteractiveBadge),
    ),
  );
  const badge = /<span class="([^"]*rounded-full[^"]*)"/.exec(html);
  expect(badge).not.toBeNull();
  return badge![1]!.split(" ");
}

// TEST_SCENARIO: the badge is exactly as tall as the chip line, with no vertical padding to push its lower part out of it.
it("is no taller than the row's chip line", () => {
  const classes = badgeClasses();
  expect(classes).toContain("h-4");
  expect(classes).toContain("py-0");
  expect(classes).not.toContain("py-0.5");
});
