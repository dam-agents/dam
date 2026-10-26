// @vitest-environment happy-dom
// TEST_OVERVIEW: A tool call that changed the Agent's own configuration shows a card under it, and the card opens the side panel tab that holds the item; a schedule is also focused there. The card is part of the Unified right toolbar experiment, so with the experiment off the call keeps the plain tool line it always had and the panel state is left alone.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { useStore } from "../../store.js";
import type { ToolChip } from "../../types.js";

const { AgentChangeCards, AgentChangeCard } =
  await import("../../modules/sessions/components/agent-change-card.js");
const { ToolPart } =
  await import("../../modules/sessions/components/chat-message-part.js");

const SCHEDULE: ToolChip = {
  kind: "tool",
  toolCallId: "t1",
  title: "mcp__platform-outbound__create_schedule",
  status: "completed",
  content: [
    {
      type: "content",
      text: JSON.stringify({ id: "sched-1", name: "Daily triage" }),
    },
  ],
};

const SKILL: ToolChip = {
  kind: "tool",
  toolCallId: "t2",
  title: "mcp__platform-outbound__install_skill",
  status: "completed",
  content: [
    {
      type: "content",
      text: "Installed release-notes @ 4f2a1c3b. Agent now has 2 skill(s).",
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
});

function mount(chip: ToolChip, cards = true) {
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(
          AgentChangeCards.Provider,
          { value: cards },
          createElement(ToolPart, { chip }),
        ),
      ),
    ),
  );
}

const card = () => container.querySelector('[data-testid="agent-change-card"]');

// TEST_SCENARIO: the Agent created a schedule; a click on the card opens the Schedules tab and focuses that schedule, so the new item is the one the panel shows.
it("opens the matching side panel tab on the schedule", () => {
  mount(SCHEDULE);
  expect(card()?.textContent).toContain("Created schedule “Daily triage”");
  act(() => (card() as HTMLElement).click());
  expect(useStore.getState().sidePanelTab).toBe("automations");
  expect(useStore.getState().sidePanelFocus).toEqual({
    tab: "automations",
    id: "sched-1",
  });
});

// TEST_SCENARIO: a skill opens its list in the Skills tab; there is no item of the list to expand, so the panel is left with nothing focused.
it("opens the Skills tab without a focus for a skill", () => {
  mount(SKILL);
  act(() => (card() as HTMLElement).click());
  expect(useStore.getState().sidePanelTab).toBe("skills");
  expect(useStore.getState().sidePanelFocus).toBe(null);
});

// TEST_SCENARIO: with the experiment off, the same tool call shows no card and a click changes nothing, so a chat with the experiment off looks and behaves exactly as before.
it("shows no card with the experiment off", () => {
  mount(SCHEDULE, false);
  expect(card()).toBe(null);
  expect(useStore.getState().sidePanelTab).toBe(null);
  expect(useStore.getState().sidePanelFocus).toBe(null);
});

// TEST_SCENARIO: the card's accessible name is the text it shows, so voice control can say what is on screen.
it("names the card with its visible text", () => {
  act(() =>
    root.render(
      createElement(
        AgentChangeCards.Provider,
        { value: true },
        createElement(AgentChangeCard, {
          change: {
            tab: "automations",
            kind: "schedule",
            verb: "created",
            id: "sched-1",
            name: "Daily triage",
          },
        }),
      ),
    ),
  );
  const button = card() as HTMLElement;
  expect(button.getAttribute("aria-label")).toBe(null);
  expect(button.textContent).toContain("Created schedule “Daily triage”");
});
