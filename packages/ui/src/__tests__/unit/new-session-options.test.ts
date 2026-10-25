// TEST_OVERVIEW: An empty chat offers ways to start a session elsewhere. With the new-layout experiment on, it is the Agent home's action list, whose CLI, editor and messenger rows slide open in place from a keyboard-reachable button; with it off, it is the launcher cards, unchanged. Each way shows only to a person who holds the Agent Permission it needs, so an Agent Editor of a Shared Agent is offered no terminal, local editor or messenger.
import { AGENT_PERMISSIONS, type AgentPermission } from "api-server-api";
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

const OWNER = { role: "owner", editors: [], permissions: AGENT_PERMISSIONS };
const EDITOR_PERMISSIONS: AgentPermission[] = AGENT_PERMISSIONS.filter(
  (p) => p !== "terminal" && p !== "channels",
);
const EDITOR = {
  role: "editor",
  ownerEmail: "jordan@example.com",
  editors: ["alex@example.com"],
  permissions: EDITOR_PERMISSIONS,
};

function render(newLayout: boolean, access: object = OWNER) {
  const agent = { id: "a1", name: "scout", access } as unknown as AgentView;
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

// TEST_SCENARIO: an editor's empty chat in the current layout offers no cards at all: every card needs the terminal or the channels permission, which only the owner holds.
it("offers an editor no launcher cards", () => {
  const html = render(false, EDITOR);
  expect(html).toBe("");
});

// TEST_SCENARIO: an editor's empty chat in JanUI keeps Configure agent but offers no web terminal, CLI and SSH, VS Code and Zed, or Slack.
it("offers an editor only Configure agent in JanUI", () => {
  const html = render(true, EDITOR);
  expect(html).toContain("Configure agent");
  for (const title of [
    "Web terminal",
    "CLI and SSH",
    "VS Code and Zed",
    "Slack",
  ])
    expect(html).not.toContain(title);
});

// TEST_SCENARIO: a person who may open terminals but not bind channels gets the terminal cards and no Slack card.
it("keeps the terminal cards without the channels permission", () => {
  const html = render(false, {
    ...OWNER,
    permissions: AGENT_PERMISSIONS.filter((p) => p !== "channels"),
  });
  expect(html).toContain("Browser Terminal");
  expect(html).toContain("VS Code / Zed");
  expect(html).not.toContain("Slack Channel");
});
