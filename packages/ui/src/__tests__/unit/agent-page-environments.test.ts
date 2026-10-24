// TEST_OVERVIEW: An agent's page shows no Environments surface until the agent owns one: its section navigation has no Environments entry, and while it has none the Manage card of its General section links to the section instead, so the owner can still name the people who may open the Environments it creates. The section itself stays at its own address with its empty text.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import type { AgentView } from "../../types.js";

const state = vi.hoisted(() => ({
  count: 0,
  enabled: true,
  navigateToSandboxHome: vi.fn(),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({
      setView: vi.fn(),
      showConfirm: vi.fn(),
      navigateToSandboxHome: state.navigateToSandboxHome,
    }),
}));
vi.mock("../../modules/agents/api/mutations.js", () => ({
  useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useSetAgentDisabled: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../modules/agents/hooks/use-confirm-delete-agent.js", () => ({
  useConfirmDeleteAgent: () => vi.fn(),
}));
vi.mock("../../modules/agents/hooks/use-restart-agent.js", () => ({
  useRestartAgent: () => ({ restart: vi.fn() }),
}));
vi.mock("../../modules/environments/api/queries.js", () => ({
  useEnvironmentsEnabled: () => state.enabled,
  useEnvironments: () => ({ data: Array.from({ length: state.count }) }),
}));

const { environmentsShown } =
  await import("../../modules/environments/lib/environments-tab.js");
const { AgentManagementActions } =
  await import("../../modules/sandboxes/components/agent-management-actions.js");

const agent = (vm = true) =>
  ({
    id: "agent-dev",
    name: "dam",
    vm,
    disabled: false,
    env: [],
  }) as unknown as AgentView;

const render = (vm = true) =>
  renderToStaticMarkup(
    createElement(AgentManagementActions, {
      agent: agent(vm),
      display: { state: "running", powerAction: "restart" } as never,
    }),
  );

// TEST_SCENARIO: the section navigation offers Environments only for a vm agent, with the feature on, and once it owns at least one; it never flashes the entry while the list is still loading.
it("shows the section only once the agent owns an Environment", () => {
  expect(environmentsShown({ enabled: true, vm: true, count: 1 })).toBe(true);
  for (const off of [
    { enabled: true, vm: true, count: 0 },
    { enabled: true, vm: true, count: undefined },
    { enabled: false, vm: true, count: 1 },
    { enabled: true, vm: false, count: 1 },
  ])
    expect(environmentsShown(off)).toBe(false);
});

// TEST_SCENARIO: with no Environment there is still a list of people to set before the first one exists, so the Manage card links to the section; once the agent owns one the section is in the navigation and the row goes, so nothing is offered twice.
it("links to the section from the Manage card only while the agent has none", () => {
  state.count = 0;
  expect(render()).toContain("Who may open Environments");
  state.count = 1;
  expect(render()).not.toContain("Who may open Environments");
});

// TEST_SCENARIO: a container agent never owns Environments, so no row offers to set who may open them.
it("offers no row for a container agent", () => {
  state.count = 0;
  expect(render(false)).not.toContain("Who may open Environments");
});
