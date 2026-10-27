// TEST_OVERVIEW: An empty chat offers ways to start a session elsewhere, as launcher cards. Each way shows only to a person who holds the Agent Permission it needs, so an Agent Editor of a Shared Agent is offered no terminal, local editor or messenger.
import { AGENT_PERMISSIONS, type AgentPermission } from "api-server-api";
import { createElement, type ReactElement } from "react";
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
vi.mock("../../modules/sessions/components/terminal-harness-menu.js", () => ({
  TerminalHarnessMenu: ({ children }: { children: ReactElement }) => children,
}));

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

function render(access: object = OWNER) {
  const agent = { id: "a1", name: "scout", access } as unknown as AgentView;
  return renderToStaticMarkup(
    createElement(NewSessionOptions, {
      agent,
      onNewTerminal: () => {},
    }),
  );
}

// TEST_SCENARIO: the launcher cards offer the web terminal, the local terminal and editor, and the messengers.
it("keeps the launcher cards", () => {
  const html = render();
  expect(html).toContain('data-testid="new-session-launcher"');
  expect(html).not.toContain("aria-expanded");
});

// TEST_SCENARIO: an editor's empty chat in the current layout offers no cards at all: every card needs the terminal or the channels permission, which only the owner holds.
it("offers an editor no launcher cards", () => {
  const html = render(EDITOR);
  expect(html).toBe("");
});

// TEST_SCENARIO: a person who may open terminals but not bind channels gets the terminal cards and no Slack card.
it("keeps the terminal cards without the channels permission", () => {
  const html = render({
    ...OWNER,
    permissions: AGENT_PERMISSIONS.filter((p) => p !== "channels"),
  });
  expect(html).toContain("Browser Terminal");
  expect(html).toContain("VS Code / Zed");
  expect(html).not.toContain("Slack Channel");
});
