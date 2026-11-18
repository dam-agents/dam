// TEST_OVERVIEW: An agent's settings show the Interactive chat section (the UI's name for chat forms) to every owner, with no feature to turn on first, and the section opens at its own address.
import { AGENT_PERMISSIONS } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import type * as AgentQueries from "../../modules/agents/api/queries.js";

vi.stubGlobal("window", new EventTarget());

const OWNS = [...AGENT_PERMISSIONS];

const state = vi.hoisted(() => ({
  section: "usage",
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({
      agentId: "agent-dev",
      sandboxSection: state.section,
      setView: vi.fn(),
      showConfirm: vi.fn(),
      openAgentSession: vi.fn(),
      navigateToSandboxHome: vi.fn(),
    }),
}));
vi.mock("../../modules/a2ui/components/chat-form-settings.js", () => ({
  ChatFormSettings: () => createElement("p", null, "CHAT-FORMS-SETTINGS"),
}));
vi.mock("../../modules/environments/api/queries.js", () => ({
  useEnvironmentsEnabled: () => false,
  useEnvironments: () => ({ data: [], isLoading: false }),
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
vi.mock("../../modules/sandboxes/hooks/use-section-summaries.js", () => ({
  useSectionSummaries: () => ({ summaries: {}, warnings: {} }),
}));
vi.mock("../../modules/processes/api/queries.js", () => ({
  useProcesses: () => ({ data: undefined }),
}));
vi.mock("../../modules/processes/components/pending-restart-banner.js", () => ({
  useApplyPendingRestartWithConfirm: () => ({ apply: vi.fn() }),
}));
vi.mock("../../modules/sandboxes/components/sandbox-home-header.js", () => ({
  SandboxHomeHeader: () => null,
  SandboxIdentity: () => null,
}));
vi.mock("../../modules/sandboxes/components/agent-config-sections.js", () => ({
  AgentDescriptionSection: () => null,
  AgentModelSettingsSection: () => null,
}));
vi.mock("../../modules/sandboxes/components/agent-usage-actions.js", () => ({
  AgentUsageActions: () => null,
}));
vi.mock(
  "../../modules/sandboxes/components/agent-management-actions.js",
  () => ({ AgentManagementActions: () => null }),
);
vi.mock("../../modules/metrics/components/sandbox-usage-section.js", () => ({
  SandboxUsageSection: () => null,
}));

const { AgentConfiguration } =
  await import("../../modules/sandboxes/components/agent-configuration.js");
const { TooltipProvider } = await import("../../components/ui/tooltip.js");

const renderPage = (section: string) =>
  renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(AgentConfiguration, {
        agent: {
          id: "agent-dev",
          name: "dam",
          vm: true,
          env: [],
          access: { role: "owner", editors: [], permissions: OWNS },
        } as never,
        display: { state: "running", powerAction: "restart" } as never,
        section: section as never,
        onNavigate: () => {},
        onOpenSession: () => {},
        oauthReturnView: "/chat/agent-dev",
      }),
    ),
  );

// TEST_SCENARIO: an owner who never touched Experimental features finds the Interactive chat section in the navigation, and its address opens its settings.
it("lists the section for every owner and opens it at its address", () => {
  expect(renderPage("usage")).toContain("Interactive chat");
  expect(renderPage("chat-forms")).toContain("CHAT-FORMS-SETTINGS");
});
