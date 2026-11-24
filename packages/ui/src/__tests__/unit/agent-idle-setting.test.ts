// TEST_OVERVIEW: An Agent stops on its own after the install's idle timeout, and the UI offers no per-agent setting for it: the agent's General section shows no "Sleep after being idle for" field, and no surface shows an "Always on" tag, because no agent is kept running.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AGENT_PERMISSIONS } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import type * as AgentQueries from "../../modules/agents/api/queries.js";

vi.stubGlobal("window", new EventTarget());

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({
      agentId: "agent-dev",
      sandboxSection: "setup",
      setView: vi.fn(),
      showConfirm: vi.fn(),
      openAgentSession: vi.fn(),
      openAgentSettings: vi.fn(),
      selectAgent: vi.fn(),
    }),
}));
vi.mock("../../modules/agents/api/queries.js", async (importOriginal) => ({
  ...(await importOriginal<typeof AgentQueries>()),
  useIsAgentInaccessible: () => false,
  useAgents: () => ({
    data: {
      list: [
        {
          id: "agent-dev",
          name: "dam",
          env: [],
          access: {
            role: "owner",
            editors: [],
            permissions: [...AGENT_PERMISSIONS],
          },
        },
      ],
      shared: [],
    },
  }),
}));
vi.mock("../../modules/agents/api/mutations.js", () => ({
  useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useSetAgentDisabled: () => ({ mutate: vi.fn(), isPending: false }),
  useLeaveAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({ data: undefined }),
}));
vi.mock("../../modules/sandboxes/components/sandbox-model-settings.js", () => ({
  SandboxModelSettings: () => null,
}));
vi.mock("../../modules/environments/api/queries.js", () => ({
  useEnvironmentsEnabled: () => false,
  useEnvironments: () => ({ data: undefined, isLoading: false }),
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
  useChatFormsEnabled: () => false,
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

const { AgentConfiguration } =
  await import("../../modules/sandboxes/components/agent-configuration.js");
const { TooltipProvider } = await import("../../components/ui/tooltip.js");

const generalSection = (minutes: number) =>
  createElement(
    TooltipProvider,
    null,
    createElement(AgentConfiguration, {
      agent: {
        id: "agent-dev",
        name: "dam",
        env: [],
        hibernationTimeoutMin: minutes,
        access: {
          role: "owner",
          editors: [],
          permissions: [...AGENT_PERMISSIONS],
        },
      } as never,
      display: { state: "running", powerAction: "restart" } as never,
      section: "setup",
      onNavigate: () => {},
      onOpenSession: () => {},
      oauthReturnView: "/sandboxes/agent-dev/connections",
    }),
  );

// TEST_SCENARIO: the General section renders its lifecycle actions but no idle-sleep field, no disable action and no "Always on" tag, for an Agent on the install's default, one that never slept, and one with a window the old menu had no option for.
it("offers no idle-sleep setting on the agent's General section", () => {
  for (const minutes of [5, 0, 15, 42]) {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        generalSection(minutes),
      ),
    );
    expect(html).toContain("Restart agent");
    expect(html).not.toContain("Disable agent");
    expect(html).not.toMatch(/sleep after|idle for/i);
    expect(html).not.toContain("sleep-after-idle");
    expect(html).not.toContain("Always on");
  }
});
