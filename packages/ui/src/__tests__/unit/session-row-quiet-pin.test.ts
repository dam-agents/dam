// TEST_OVERVIEW: A pinned Session row marks its pin with an icon, except where its section already says it is pinned (the new layout's Pinned section): there the pin shows only with the row's actions, on hover or while the row holds keyboard focus, and the unpin button stays in the row for the keyboard.
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
  useAgentsList: () => [],
}));

const { SessionRow } =
  await import("../../modules/sessions/components/session-row.js");

function render(quietPin: boolean) {
  return renderToStaticMarkup(
    createElement(SessionRow, {
      session: {
        agentId: "a",
        sessionId: "s1",
        mode: SessionMode.Chat,
        type: SessionType.Regular,
        title: "Recent",
        createdAt: "2026-10-20T00:00:00Z",
      } as never,
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

// TEST_SCENARIO: the current layout keeps the pin mark; a quiet pin drops it, and its actions open on keyboard focus anywhere in the row, the unpin button among them.
it("shows a quiet pin only with the row's actions", () => {
  expect(render(false)).toContain('aria-label="Pinned"');
  const quiet = render(true);
  expect(quiet).not.toContain('aria-label="Pinned"');
  expect(quiet).toMatch(
    /data-row-actions[^>]*group-has-\[:focus-visible\]:w-auto/,
  );
  expect(quiet).toContain('aria-label="Unpin session"');
});
