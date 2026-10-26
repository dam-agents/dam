// TEST_OVERVIEW: A Session row marks a terminal Session with its own icon and lists the repositories the Session touched under the row.
import { SessionMode, SessionType } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.hoisted(() => vi.stubGlobal("window", new EventTarget()));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({ drafts: {}, pendingPermissions: [] }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: () => null,
  useAgentsList: () => [],
}));

const { SessionRow } =
  await import("../../modules/sessions/components/session-row.js");

function render(mode = SessionMode.Chat) {
  return renderToStaticMarkup(
    createElement(SessionRow, {
      session: {
        agentId: "a",
        sessionId: "s1",
        mode,
        type: SessionType.Regular,
        title: "Recent",
        createdAt: "2026-10-20T00:00:00Z",
        repositories: [{ name: "dam", path: "/work/dam", branch: "main" }],
      } as never,
      active: false,
      working: false,
      needsApproval: false,
      onResume: () => {},
      onRename: () => {},
      onDelete: () => {},
    }),
  );
}

// TEST_SCENARIO: a terminal Session is marked by the terminal icon, with its accessible name.
it("marks a terminal Session with the labelled terminal icon", () => {
  expect(render(SessionMode.Terminal)).toMatch(
    /<svg[^>]*aria-label="Terminal"/,
  );
  expect(render()).not.toContain('aria-label="Terminal"');
});

// TEST_SCENARIO: the row lists the repositories the Session touched under it.
it("lists the repositories the Session touched", () => {
  expect(render()).toContain("Repositories this session touched");
});
