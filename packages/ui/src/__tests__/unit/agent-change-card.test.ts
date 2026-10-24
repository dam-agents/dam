// @vitest-environment happy-dom
// TEST_OVERVIEW: A tool call that changed the Agent's own configuration shows a card under it, and the card opens the side panel tab that holds the item. The card is part of the Unified right toolbar experiment, so with the experiment off the call keeps the plain tool line it always had.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { useStore } from "../../store.js";
import type { ToolChip } from "../../types.js";

const fake = vi.hoisted(() => ({ toolbar: true }));

vi.mock("../../modules/features/hooks/use-unified-right-toolbar.js", () => ({
  useUnifiedRightToolbar: () => fake.toolbar,
}));

const { ToolPart } =
  await import("../../modules/sessions/components/chat-message-part.js");

const CHIP: ToolChip = {
  kind: "tool",
  toolCallId: "t1",
  title: "mcp__platform__create_schedule",
  status: "completed",
  content: [
    {
      type: "content",
      text: JSON.stringify({ id: "sched-1", name: "Daily triage" }),
    },
  ],
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useStore.setState({ sidePanelTab: null, sidePanelFocus: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  fake.toolbar = true;
});

function mount() {
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ToolPart, { chip: CHIP }),
      ),
    ),
  );
}

const card = () => container.querySelector('[data-testid="agent-change-card"]');

// TEST_SCENARIO: the Agent created a schedule; a click on the card opens the Schedules tab and points it at that schedule, so the new item is the one the panel shows.
it("opens the matching side panel tab on the item", () => {
  mount();
  expect(card()?.textContent).toContain("Created schedule “Daily triage”");
  act(() => (card() as HTMLElement).click());
  expect(useStore.getState().sidePanelTab).toBe("schedules");
  expect(useStore.getState().sidePanelFocus).toEqual({
    tab: "schedules",
    id: "sched-1",
  });
});

// TEST_SCENARIO: with the experiment off, the same tool call shows no card and the panel state is left alone, so a chat with the experiment off looks exactly as before.
it("shows no card with the experiment off", () => {
  fake.toolbar = false;
  mount();
  expect(card()).toBe(null);
});
