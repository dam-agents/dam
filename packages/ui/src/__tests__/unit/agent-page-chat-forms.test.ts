// TEST_OVERVIEW: An agent's page shows the Chat forms section only while chat forms are on for the account, since the only setting left there is about chat forms; the section keeps its own address and its content, so a stale link still works.
import { AGENT_PERMISSIONS } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import type * as AgentQueries from "../../modules/agents/api/queries.js";

vi.stubGlobal("window", new EventTarget());

const OWNS = [...AGENT_PERMISSIONS];

const state = vi.hoisted(() => ({
  chatForms: false,
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
vi.mock("../../modules/a2ui/hooks/use-chat-forms-enabled.js", () => ({
  useChatFormsEnabled: () => state.chatForms,
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

const { SandboxHomeView } =
  await import("../../modules/sandboxes/views/sandbox-home-view.js");

const renderPage = (section: string) => {
  state.section = section;
  return renderToStaticMarkup(createElement(SandboxHomeView));
};

// TEST_SCENARIO: with chat forms off the section has nothing left to offer — the thinking setting moved to Settings › Appearance — so it leaves the navigation.
it("hides the navigation entry while chat forms are off", () => {
  state.chatForms = false;
  expect(renderPage("usage")).not.toContain("Chat forms");
});

// TEST_SCENARIO: with chat forms on the section returns, and a link to it still opens it while the feature is off.
it("shows the navigation entry with chat forms on, and keeps the address", () => {
  state.chatForms = true;
  expect(renderPage("usage")).toContain("Chat forms");
  state.chatForms = false;
  expect(renderPage("chat-forms")).toContain("CHAT-FORMS-SETTINGS");
});
