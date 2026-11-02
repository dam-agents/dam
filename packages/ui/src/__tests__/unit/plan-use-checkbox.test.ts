// TEST_OVERVIEW: The "Show what subscriptions cover" checkbox on Usage tells a screen reader what it controls, and is big enough to tap on a phone.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { PlanUseCheckbox } from "../../modules/spend/components/plan-use-checkbox.js";
import { SHOW_PLAN_USE } from "../../modules/spend/lib/copy.js";

vi.mock("../../modules/spend/hooks/use-spend-preferences.js", () => ({
  useShowPlanUse: () => false,
  useSetShowPlanUse: () => vi.fn(),
}));

function checkboxTag(): string {
  const html = renderToStaticMarkup(
    createElement(TooltipProvider, null, createElement(PlanUseCheckbox)),
  );
  const tag = /<button[^>]*role="checkbox"[^>]*>/.exec(html)?.[0];
  if (!tag) throw new Error(`no checkbox in ${html}`);
  return tag;
}

// TEST_SCENARIO: the checkbox carries its own accessible name, the text next to it.
it("names the checkbox", () => {
  expect(checkboxTag()).toContain(`aria-label="${SHOW_PLAN_USE}"`);
});

// TEST_SCENARIO: below the sm breakpoint the checkbox is 24 px, the smallest tap target.
it("is 24 px on a phone", () => {
  expect(checkboxTag()).toContain("max-sm:size-6");
});
