// @vitest-environment happy-dom
// TEST_OVERVIEW: a held change names the Agent it will act on. An Agent shared with this person as an editor is not in the owned list, so the card has to resolve it through the shared-aware lookup: the owner sees the name, never a raw id.
import type { ApprovalView } from "api-server-api";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const SHARED = {
  id: "agent-0123456789abcdef",
  name: "Review bot",
  access: { role: "editor" as const },
};

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("../../modules/agents/api/queries.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // UNIT_BOUNDARY_DESCRIPTION: the query is stubbed, the lookup is real — the owned list is empty and the shared list holds the target.
  useAgents: () => ({ data: { list: [], shared: [SHARED] } }),
}));
vi.mock("../../modules/agents/components/avatar/agent-avatar.js", () => ({
  AgentAvatar: () => null,
}));
vi.mock("../../modules/approvals/components/approval-actions-menu.js", () => ({
  ApprovalActionsMenu: (_props: {
    actions: readonly unknown[];
    inline: readonly unknown[];
  }) => createElement("div", { "data-testid": "menu" }),
}));
vi.mock("../../modules/approvals/hooks/use-approval-actions.js", () => ({
  useApprovalActions: () => ({
    actions: [],
    primary: "allow-once",
    inflight: false,
    hostLabel: null,
    expiredNote: null,
    openSettings: () => {},
  }),
}));
vi.mock("../../modules/connections/api/queries.js", () => ({
  useAppConnections: () => ({ data: [] }),
}));

const { FeedApprovalCard } =
  await import("../../modules/home/components/feed-approval-card.js");

function change(targetId: string): ApprovalView {
  return {
    id: "agentchange:1",
    type: "agent_change",
    agentId: "agent-assistant",
    sessionId: null,
    createdAt: "2026-11-09T10:00:00Z",
    expiresAt: "2026-11-10T10:00:00Z",
    resolvedAt: null,
    verdict: null,
    status: "pending",
    payload: {
      kind: "agent_change",
      procedure: "agents.update",
      title: "Change an Agent's settings",
      detail: "{}",
      input: { id: targetId, name: "renamed" },
    },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(approval: ApprovalView) {
  act(() =>
    root.render(
      createElement(FeedApprovalCard, {
        approval,
        agentName: "Dambledore",
        avatarName: "Dambledore",
        avatar: null,
        meta: "now",
        onDismiss: () => {},
      }) as ReactNode,
    ),
  );
  return (
    container.querySelector('[data-testid="feed-approval-target"]')
      ?.textContent ?? ""
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the arguments view prints the raw input by design (a field the owner cannot see is a field they did not approve), so what this pins is the target line naming the Agent.
it("shows a shared Agent's name for a held change", () => {
  const target = render(change(SHARED.id));
  expect(target).toContain("Review bot");
  expect(target).not.toContain(SHARED.id);
});

it("falls back to the id only when the Agent is unknown", () => {
  expect(render(change("agent-ffffffffffffffff"))).toContain(
    "agent-ffffffffffffffff",
  );
});
