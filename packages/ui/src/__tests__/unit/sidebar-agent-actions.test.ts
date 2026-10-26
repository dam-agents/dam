// @vitest-environment happy-dom
// TEST_OVERVIEW: an Agent's row in the sidebar shows New session and, while the Unified right toolbar experiment is off, Configure agent as the wrench that opens the configuration page; with the experiment on that page has no surface, so the row shows a three-dot menu of Rename, Disable, Restart and Remove instead. The Agent actions kebab with the messenger binding stays apart, and only when a Slack or Telegram channel is there to add the Agent to.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import type { AgentView } from "../../types.js";

const state = vi.hoisted(() => ({ rightToolbar: false }));

vi.mock("../../modules/features/hooks/use-unified-right-toolbar.js", () => ({
  useUnifiedRightToolbar: () => state.rightToolbar,
}));
vi.mock("../../modules/agents/hooks/use-agent-menu-actions.js", () => ({
  useAgentMenuActions: () => ({
    updateAvailable: false,
    onConfigure: () => {},
    onToggleDisabled: () => {},
    onRestart: () => {},
    onRemove: () => {},
  }),
}));

const { SidebarAgentActions } =
  await import("../../modules/agents/components/sidebar-agent-actions.js");

const agent = {
  id: "a1",
  name: "Pennington",
  avatar: null,
  disabled: false,
} as unknown as AgentView;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  state.rightToolbar = false;
});

function render(channels: { slack?: boolean; telegram?: boolean }) {
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(SidebarAgentActions, {
          agent,
          current: false,
          channels,
          onNewSession: () => {},
          onConfigure: () => {},
          onNavigate: () => {},
          onBind: () => {},
        }),
      ),
    ),
  );
}

const configure = () =>
  container.querySelector('[aria-label="Configure agent"]');
const rowMenu = () =>
  container.querySelector('[data-testid="sidebar-agent-actions-menu"]');

// TEST_SCENARIO: with the experiment off and no channel, the row keeps its New session and Configure agent icons and shows no menu.
it("keeps the Configure wrench with the experiment off", () => {
  render({});
  expect(container.querySelector('[aria-label="New session"]')).not.toBe(null);
  expect(configure()).not.toBe(null);
  expect(rowMenu()).toBe(null);
});

// TEST_SCENARIO: with the experiment on, the wrench is gone and a three-dot menu stands in its place.
it("replaces the wrench with the three-dot menu", () => {
  state.rightToolbar = true;
  render({});
  expect(configure()).toBe(null);
  expect(rowMenu()).not.toBe(null);
  expect(rowMenu()?.getAttribute("aria-label")).toBe("Agent actions");
});

// TEST_SCENARIO: the messenger binding kebab stays apart and appears only when a channel can take the Agent.
it("keeps the messenger kebab separate", () => {
  render({ slack: true });
  expect(
    container.querySelector('[data-testid="sidebar-agent-menu"]'),
  ).not.toBe(null);
  expect(configure()).not.toBe(null);
  render({});
  expect(container.querySelector('[data-testid="sidebar-agent-menu"]')).toBe(
    null,
  );
});
