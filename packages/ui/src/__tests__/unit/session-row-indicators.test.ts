// TEST_OVERVIEW: A Session row marks a terminal Session with its own icon and lists the repositories the Session has pull requests in under the row.
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

function render(
  mode = SessionMode.Chat,
  repositories: unknown[] = [
    {
      name: "dam",
      path: "/work/dam",
      branch: "fix/one",
      pullRequest: { number: 7, url: "https://github.com/acme/dam/pull/7" },
    },
  ],
) {
  return renderToStaticMarkup(
    createElement(SessionRow, {
      session: {
        agentId: "a",
        sessionId: "s1",
        mode,
        type: SessionType.Regular,
        title: "Recent",
        createdAt: "2026-10-20T00:00:00Z",
        repositories,
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

// TEST_SCENARIO: the row lists the repositories the Session has pull requests in under it, each with its number.
it("lists the repositories the Session has pull requests in", () => {
  expect(render()).toContain("Repositories this session has pull requests in");
  expect(render()).toContain("#7");
});

// TEST_SCENARIO: a Session lists every repository it committed in, and the tools it runs commit in caches and plugins too; the row badges only those with a pull request, so a Session with none draws no repository line.
it("badges only the repositories with a pull request", () => {
  const cache = { name: "cache", path: "/tmp/cache", branch: "main" };
  expect(
    render(SessionMode.Chat, [{ ...cache, pullRequest: null }]),
  ).not.toContain("Repositories this session has pull requests in");
});
