// TEST_OVERVIEW: An agent's settings show no Environments surface until the agent owns one: their section navigation has no Environments entry, and while it has none the Manage card of the General section links to the section instead, so the owner can still name the people who may open the Environments it creates. The section itself still opens, with its empty text, so an old link to it works.
import { AGENT_PERMISSIONS } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import type * as AgentQueries from "../../modules/agents/api/queries.js";
import type { AgentView } from "../../types.js";

vi.stubGlobal("window", new EventTarget());

const OWNS = [...AGENT_PERMISSIONS];

const state = vi.hoisted(() => ({
  count: 0,
  loading: false,
  enabled: true,
  section: "usage",
  openAgentSettings: vi.fn(),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({
      agentId: "agent-dev",
      sandboxSection: state.section,
      setView: vi.fn(),
      showConfirm: vi.fn(),
      openAgentSession: vi.fn(),
      openAgentSettings: state.openAgentSettings,
    }),
}));
vi.mock("../../modules/environments/api/queries.js", () => ({
  useEnvironmentsEnabled: () => state.enabled,
  useEnvironments: (agentId: string | null) =>
    agentId === null
      ? { data: undefined, isLoading: false }
      : {
          data: state.loading ? undefined : Array.from({ length: state.count }),
          isLoading: state.loading,
        },
}));
vi.mock("../../modules/agents/api/queries.js", async (importOriginal) => ({
  findAgent: (await importOriginal<typeof AgentQueries>()).findAgent,
  useIsAgentInaccessible: () => false,
  useAgents: () => ({
    data: {
      list: [
        {
          id: "agent-dev",
          name: "dam",
          vm: true,
          access: { role: "owner", editors: [], permissions: OWNS },
        },
      ],
      shared: [],
    },
  }),
}));
vi.mock("../../modules/agents/api/mutations.js", () => ({
  useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useLeaveAgent: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../modules/agents/hooks/use-confirm-delete-agent.js", () => ({
  useConfirmDeleteAgent: () => vi.fn(),
}));
vi.mock("../../modules/agents/hooks/use-restart-agent.js", () => ({
  useRestartAgent: () => ({ restart: vi.fn() }),
}));
vi.mock("../../modules/agents/hooks/use-harness-config-watch.js", () => ({
  useHarnessConfigWatch: () => {},
}));
vi.mock("../../modules/agents/hooks/use-public-agent-fallback.js", () => ({
  usePublicAgentFallback: () => {},
}));
vi.mock("../../modules/agents/hooks/use-resolved-agent-display.js", () => ({
  useResolvedAgentDisplay: () => ({ state: "running", powerAction: "restart" }),
}));
vi.mock("../../modules/a2ui/hooks/use-chat-forms-enabled.js", () => ({
  useChatFormsEnabled: () => true,
}));
vi.mock("../../modules/sandboxes/hooks/use-section-summaries.js", () => ({
  useSectionSummaries: () => ({ summaries: {}, warnings: {} }),
}));
vi.mock("../../modules/processes/api/queries.js", () => ({
  useProcesses: () => ({ data: undefined }),
}));
vi.mock("../../modules/processes/components/pending-restart-banner.js", () => ({
  useApplyPendingRestartWithConfirm: () => ({ apply: vi.fn() }),
}));
vi.mock(
  "../../modules/environments/components/agent-environment-members.js",
  () => ({
    AgentEnvironmentsSection: () =>
      createElement("p", null, "ENVIRONMENTS-SECTION"),
  }),
);
vi.mock("../../modules/sandboxes/components/sandbox-home-header.js", () => ({
  SandboxHomeHeader: () => null,
  SandboxIdentity: () => null,
}));
vi.mock("../../modules/sandboxes/components/agent-config-sections.js", () => ({
  AgentModelSettingsSection: () => null,
}));
vi.mock("../../modules/metrics/components/sandbox-usage-section.js", () => ({
  SandboxUsageSection: () => null,
}));

const { environmentsShown } =
  await import("../../modules/environments/lib/environments-tab.js");
const { AgentManagementActions } =
  await import("../../modules/sandboxes/components/agent-management-actions.js");
const { AgentConfiguration } =
  await import("../../modules/sandboxes/components/agent-configuration.js");
const { TooltipProvider } = await import("../../components/ui/tooltip.js");

const agent = () =>
  ({
    id: "agent-dev",
    name: "dam",
    env: [],
    access: { role: "owner", editors: [], permissions: OWNS },
  }) as unknown as AgentView;

const renderRow = () =>
  renderToStaticMarkup(
    createElement(AgentManagementActions, {
      agent: agent(),
      display: { state: "running", powerAction: "restart" } as never,
    }),
  );

const renderPage = (section: string) => {
  state.section = section;
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(AgentConfiguration, {
        agent: agent(),
        display: { state: "running", powerAction: "restart" } as never,
        section: section as never,
        onNavigate: () => {},
        onOpenSession: () => {},
        oauthReturnView: "/sandboxes/agent-dev/connections",
      }),
    ),
  );
};

// TEST_SCENARIO: the section navigation offers Environments with the feature on, and once the agent owns at least one; it never flashes the entry while the list is still loading.
it("shows the section only once the agent owns an Environment", () => {
  expect(environmentsShown({ enabled: true, count: 1 })).toBe(true);
  for (const off of [
    { enabled: true, count: 0 },
    { enabled: true, count: undefined },
    { enabled: false, count: 1 },
  ])
    expect(environmentsShown(off)).toBe(false);
});

// TEST_SCENARIO: the agent's settings list Environments in their section navigation only once the agent owns one, and the section still opens with its content, so a stale link works.
it("hides the navigation entry until the agent owns one, and still opens the section", () => {
  state.count = 0;
  expect(renderPage("usage")).not.toContain("Environments");
  expect(renderPage("environments")).toContain("ENVIRONMENTS-SECTION");
  expect(renderPage("environments")).not.toContain(">Environments<");
  state.count = 1;
  expect(renderPage("usage")).toContain("Environments");
});

// TEST_SCENARIO: with no Environment there is still a list of people to set before the first one exists, so the Manage card links to the section; once the agent owns one the section is in the navigation and the row goes, so nothing is offered twice. While the list loads the row waits, so it never flashes for an agent that has one.
it("links to the section from the Manage card only while the agent has none", () => {
  state.count = 0;
  state.loading = false;
  expect(renderRow()).toContain("Choose who may open Environments");
  state.count = 1;
  expect(renderRow()).not.toContain("Choose who may open Environments");
  state.loading = true;
  expect(renderRow()).not.toContain("Choose who may open Environments");
  state.loading = false;
});
