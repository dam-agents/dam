// @vitest-environment happy-dom
// TEST_OVERVIEW: A tile of the Unified right toolbar keeps its button, and the keyboard focus on it, when a badge appears or goes away, such as a new approval arriving while the Approvals tile has focus.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import {
  type SidePanelBadge,
  SidePanelBar,
} from "../../modules/sessions/components/side-panel-bar.js";

vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => true,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// TEST_SCENARIO: the focused Approvals tile gets a count badge and then loses it, and focus stays on the same button throughout.
it("keeps the focused tile's button across a badge change", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const draw = (approvals?: SidePanelBadge) =>
    act(() =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(SidePanelBar, {
            active: null,
            hidden: new Set<never>(),
            onSelect: () => {},
            tiles: true,
            badges: approvals ? { approvals } : undefined,
          }),
        ),
      ),
    );
  draw();
  const button = host.querySelector<HTMLButtonElement>(
    '[data-testid="side-panel-tab-approvals"]',
  )!;
  button.focus();
  draw({ count: 1, label: "Approvals, 1 waiting", tone: "warning" });
  expect(host.querySelector('[data-testid="side-panel-tab-approvals"]')).toBe(
    button,
  );
  expect(document.activeElement).toBe(button);
  draw();
  expect(document.activeElement).toBe(button);
  act(() => root.unmount());
  host.remove();
});
