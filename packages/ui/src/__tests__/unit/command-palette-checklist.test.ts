// @vitest-environment happy-dom
// TEST_OVERVIEW: The palette's Get started command drives the floating checklist itself: opening goes through the same entry the avatar picker uses, which also brings back a dismissed checklist, and closing collapses the open card to its pill.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { PaletteActions } from "../../modules/command-palette/lib/palette-command.js";

const openChecklist = vi.hoisted(() => vi.fn());

vi.mock("../../modules/getting-started/hooks/use-open-checklist.js", () => ({
  useOpenChecklist: () => openChecklist,
}));

const { useStore } = await import("../../store.js");
const { usePaletteActions } =
  await import("../../modules/command-palette/hooks/use-palette-actions.js");

// TEST_SCENARIO: "get started: open checklist" asks the checklist's own opener, and "close checklist" collapses the card.
it("opens and closes the floating checklist", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let actions: PaletteActions | undefined;
  const Probe = () => {
    actions = usePaletteActions({
      onBind: () => {},
      onRenameSession: () => {},
    });
    return null;
  };
  const root = createRoot(document.createElement("div"));
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        {
          client: new QueryClient({
            defaultOptions: { queries: { enabled: false } },
          }),
        },
        createElement(Probe),
      ),
    ),
  );
  actions!.setChecklistOpen(true);
  expect(openChecklist).toHaveBeenCalledOnce();
  act(() => useStore.setState({ checklistExpanded: true }));
  actions!.setChecklistOpen(false);
  expect(useStore.getState().checklistExpanded).toBe(false);
  act(() => root.unmount());
});
