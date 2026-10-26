// @vitest-environment happy-dom
// TEST_OVERVIEW: an Agent's row in the sidebar shows New session and Configure agent as the wrench that opens the configuration page. The Agent actions kebab with the messenger binding stays apart, and only when a Slack or Telegram channel is there to add the Agent to.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const { SidebarAgentActions } =
  await import("../../modules/agents/components/sidebar-agent-actions.js");

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
});

function render(channels: { slack?: boolean; telegram?: boolean }) {
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(SidebarAgentActions, {
          channels,
          onNewSession: () => {},
          onConfigure: () => {},
          onBind: () => {},
        }),
      ),
    ),
  );
}

const configure = () =>
  container.querySelector('[aria-label="Configure agent"]');
// TEST_SCENARIO: with no channel the row keeps its New session and Configure agent icons and shows no menu.
it("keeps the Configure wrench", () => {
  render({});
  expect(container.querySelector('[aria-label="New session"]')).not.toBe(null);
  expect(configure()).not.toBe(null);
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
