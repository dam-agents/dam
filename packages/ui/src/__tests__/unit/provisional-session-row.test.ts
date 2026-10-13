// TEST_OVERVIEW: A provisional session row is display-only: its rename, delete and export actions stay visible but disabled until the agent answers for its sessions.
import { SessionMode, SessionType } from "api-server-api";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/components/ui/row-actions-menu", () => ({
  RowActionsMenu: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenuItem: ({
    children,
    disabled,
  }: {
    children: ReactNode;
    disabled?: boolean;
  }) => createElement("li", { "aria-disabled": disabled }, children),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentsList: () => [],
}));

const { SessionRow } =
  await import("../../modules/sessions/components/session-row.js");

function render(provisional: boolean) {
  return renderToStaticMarkup(
    createElement(SessionRow, {
      session: {
        sessionId: "s1",
        agentId: "agent-a",
        type: SessionType.Regular,
        mode: SessionMode.Chat,
        createdAt: "2026-10-01T10:00:00.000Z",
        title: "Report",
      },
      active: false,
      working: false,
      needsApproval: false,
      provisional,
      onResume: () => {},
      onRename: () => {},
      onDelete: () => {},
      onExportTimeline: () => {},
    }),
  );
}

it("disables every action on a provisional row", () => {
  expect(render(true).match(/<li aria-disabled="true">/g)).toHaveLength(3);
});

it("keeps the actions enabled on a row the agent listed", () => {
  expect(render(false)).not.toContain('aria-disabled="true"');
});
