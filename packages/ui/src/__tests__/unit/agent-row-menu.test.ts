// TEST_OVERVIEW: An Agent's row menu offers its configuration page while the Unified right toolbar experiment is off. With the experiment on, the page is gone, so the menu offers the Agent itself: rename (name and avatar in one dialog), disable or enable, restart, and remove.
import { expect, it, vi } from "vitest";

vi.hoisted(() => vi.stubGlobal("window", new EventTarget()));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({ showConfirm: async () => true }),
}));
vi.mock("../../modules/agents/api/mutations.js", () => ({
  useDeleteAgent: () => ({ mutate: vi.fn() }),
  useSetAgentDisabled: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../modules/agents/hooks/use-restart-agent.js", () => ({
  useRestartAgent: () => ({ restart: vi.fn() }),
}));
vi.mock("../../modules/agents/hooks/use-confirm-delete-agent.js", () => ({
  useConfirmDeleteAgent: () => async () => false,
}));
vi.mock("../../modules/features/hooks/use-unified-right-toolbar.js", () => ({
  useUnifiedRightToolbar: () => false,
}));

const { agentMenuEntries } =
  await import("../../modules/platform/components/sidebar-v2/agent-row-actions.js");

// TEST_SCENARIO: with the experiment off, the row menu keeps the way into the configuration page; with it on, that page is not a destination, so the menu carries the Agent's own verbs and nothing opens the page.
it("lists the Agent's own verbs under the experiment", () => {
  expect(agentMenuEntries(false)).toEqual(["configure", "remove"]);
  expect(agentMenuEntries(true)).toEqual([
    "rename",
    "disable",
    "restart",
    "remove",
  ]);
});
