// @vitest-environment happy-dom
// TEST_OVERVIEW: A right click on a Session row opens the same Rename and Delete menu as its "⋯" button, at the pointer, instead of the browser's own menu.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: () => null,
  useAgentsList: () => [],
}));
vi.mock("../../modules/agents/utils/agent-kind.js", () => ({
  onboardingBadge: () => null,
}));
vi.mock(
  "../../modules/changes/components/session-repository-badges.js",
  () => ({
    SessionRepositoryBadges: () => null,
  }),
);
vi.mock("../../modules/sessions/components/working-dots.js", () => ({
  WorkingDots: () => null,
}));

const { SessionRow } =
  await import("../../modules/sessions/components/session-row.js");

// TEST_SCENARIO: the row's menu opens where the right click landed, so it is the row's own context menu and not the one anchored to its "⋯" button.
it("opens the row's menu on a right click", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(SessionRow, {
        session: {
          sessionId: "s1",
          agentId: "a1",
          type: 1,
          mode: 1,
          createdAt: "2026-10-01T08:00:00Z",
          updatedAt: "2026-10-01T08:00:00Z",
        } as never,
        active: false,
        working: false,
        needsApproval: false,
        onResume: () => {},
        onRename: () => {},
        onDelete: () => {},
      }),
    ),
  );
  const row = container.querySelector('[data-testid="session-row"]')!;
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 60,
    clientY: 120,
  });
  act(() => {
    row.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(document.body.textContent).toContain("Rename session");
  expect(document.body.textContent).toContain("Delete session");
  expect(
    container
      .querySelector('[data-testid="session-menu-button"]')
      ?.getAttribute("data-state"),
  ).not.toBe("open");
  act(() => root.unmount());
  container.remove();
});
