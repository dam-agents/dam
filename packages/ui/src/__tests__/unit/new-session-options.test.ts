// TEST_OVERVIEW: An empty chat offers ways to start a session elsewhere. With the new-layout experiment on, it is the Agent home's action list, whose CLI, editor and messenger rows slide open in place from a keyboard-reachable button; with it off, it is the launcher cards, unchanged.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { NewSessionOptions } from "../../modules/sessions/components/new-session-launcher.js";
import type { AgentView } from "../../types.js";

vi.hoisted(() => vi.stubGlobal("window", new EventTarget()));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) => select({}),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgents: () => ({
    data: { availableChannels: { slack: true }, list: undefined },
  }),
}));
vi.mock("../../modules/links/api/queries.js", () => ({
  useSlackInstallRequestUrl: () => undefined,
}));
vi.mock(
  "../../modules/sessions/components/terminal-harness-buttons.js",
  () => ({
    TerminalHarnessButtons: () => null,
  }),
);

const agent = { id: "a1", name: "scout" } as AgentView;

function render(newLayout: boolean) {
  return renderToStaticMarkup(
    createElement(NewSessionOptions, {
      agent,
      newLayout,
      onNewTerminal: () => {},
    }),
  );
}

// TEST_SCENARIO: with the flag on, CLI and SSH, VS Code and Zed and Slack are closed sections behind buttons that name what they control, and Configure agent ends the list.
it("shows the sliding sections in JanUI", () => {
  const html = render(true);
  expect(html).not.toContain('data-testid="new-session-launcher"');
  const toggles = html.match(/<button[^>]*aria-expanded="false"[^>]*>/g) ?? [];
  expect(toggles).toHaveLength(3);
  for (const toggle of toggles) expect(toggle).toMatch(/aria-controls="[^"]+"/);
  expect(html).toContain("CLI and SSH");
  expect(html).toContain("Configure agent");
  expect(html).not.toContain(">Chat<");
});

// TEST_SCENARIO: with the flag off, the launcher cards stay as they are.
it("keeps the launcher cards in the current layout", () => {
  const html = render(false);
  expect(html).toContain('data-testid="new-session-launcher"');
  expect(html).not.toContain("aria-expanded");
});
