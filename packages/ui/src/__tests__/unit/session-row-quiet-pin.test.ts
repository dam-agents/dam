// TEST_OVERVIEW: A pinned Session row marks its pin with an icon, except where its section already says it is pinned (JanUI's Pinned section): there the pin shows only with the row's actions, on hover or while the row holds keyboard focus. The pin itself is one of the row's menu actions, not a button of its own.
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
  quietPin: boolean,
  mode = SessionMode.Chat,
  extra: { repositoryBadges?: boolean } = {},
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
      ...extra,
      active: false,
      working: false,
      needsApproval: false,
      pinned: true,
      quietPin,
      onTogglePin: () => {},
      onResume: () => {},
      onRename: () => {},
      onDelete: () => {},
    }),
  );
}

// TEST_SCENARIO: the current layout keeps the pin mark, and a quiet pin drops it; the pin itself is an action of the row's menu, so the row holds no pin button of its own.
it("shows a quiet pin only with the row's actions", () => {
  expect(render(false)).toContain('aria-label="Pinned"');
  const quiet = render(true);
  expect(quiet).not.toContain('aria-label="Pinned"');
  expect(quiet).toMatch(
    /data-row-actions[^>]*group-has-\[:focus-visible\]:w-auto/,
  );
  expect(quiet).not.toContain('aria-label="Unpin session"');
  expect(quiet).not.toContain("session-pin-button");
});

// TEST_SCENARIO: a terminal Session is marked by the terminal icon, with its accessible name, as before JanUI's context line existed.
it("marks a terminal Session with the labelled terminal icon", () => {
  expect(render(true, SessionMode.Terminal)).toMatch(
    /<svg[^>]*aria-label="Terminal"/,
  );
  expect(render(true)).not.toContain('aria-label="Terminal"');
});

// TEST_SCENARIO: the current layout lists the repositories a Session has pull requests in under its row; a row that turns them off, as JanUI's two-line sidebar rows do, draws no repository line.
it("drops the repository line only when asked", () => {
  expect(render(false)).toContain(
    "Repositories this session has pull requests in",
  );
  expect(
    render(false, SessionMode.Chat, { repositoryBadges: false }),
  ).not.toContain("Repositories this session has pull requests in");
});

// TEST_SCENARIO: a Session lists every repository it committed in, and the tools it runs commit in caches and plugins too; the row badges only those with a pull request, so a Session with none draws no repository line.
it("badges only the repositories with a pull request", () => {
  const withPullRequest = render(false);
  expect(withPullRequest).toContain(
    "Repositories this session has pull requests in",
  );
  expect(withPullRequest).toContain("#7");
  const cache = { name: "cache", path: "/tmp/cache", branch: "main" };
  expect(
    render(false, SessionMode.Chat, {}, [{ ...cache, pullRequest: null }]),
  ).not.toContain("Repositories this session has pull requests in");
});
