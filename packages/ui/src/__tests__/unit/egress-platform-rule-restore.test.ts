// @vitest-environment happy-dom
// TEST_OVERVIEW: the agent's Network access list after its owner removed the platform's Environments rule: Restore stays reachable whatever else the list holds, the agent's last rule included.
import type { EgressRuleView } from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const state = vi.hoisted(() => ({
  rules: [] as EgressRuleView[],
  platform: { state: "removed", host: "*.env.example.com" } as
    { state: "removed" | "active"; host: string } | { state: "unavailable" },
  restored: [] as unknown[],
}));

vi.mock("../../modules/egress-rules/api/queries.js", () => ({
  useEgressRulesForAgent: () => ({
    data: state.rules,
    isLoading: false,
    isError: false,
  }),
  useCurrentPreset: () => ({ data: "none" }),
  usePlatformRule: () => ({ data: state.platform }),
}));
vi.mock("../../modules/egress-rules/api/mutations.js", () => ({
  useApplyEgressPreset: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateEgressRule: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeEgressRule: () => ({ mutate: vi.fn(), isPending: false }),
  useRestorePlatformRule: () => ({
    mutate: (input: unknown) => state.restored.push(input),
    isPending: false,
  }),
}));
vi.mock("../../modules/connections/api/queries.js", () => ({
  useAgentPageConnections: () => ({ data: [] }),
}));
vi.mock("../../auth.js", () => ({
  getUser: () => ({ profile: { sub: "alice" } }),
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ showConfirm: vi.fn() }),
}));

const { AgentEgressEditor } =
  await import("../../modules/egress-rules/components/agent-egress-editor.js");

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root!.render(
      createElement(
        TooltipProvider,
        null,
        createElement(AgentEgressEditor, {
          agentId: "agent-a",
          header: () => null,
        }),
      ),
    ),
  );
  return document;
}

describe("restoring the platform's Environments rule", () => {
  // TEST_SCENARIO: the owner removed the platform's rule and the agent has no other rule. The list still shows the removed rule with Restore, not the empty state, and Restore puts it back for that agent.
  it("offers Restore when it was the agent's only rule", () => {
    state.rules = [];
    state.restored = [];
    const doc = mount();
    expect(doc.body.textContent).not.toContain("No rules yet");
    const restore = doc.querySelector(
      '[data-testid="egress-platform-restore"]',
    ) as HTMLButtonElement | null;
    expect(restore).not.toBeNull();
    act(() => restore!.click());
    expect(state.restored).toEqual([{ agentId: "agent-a" }]);
  });

  // TEST_SCENARIO: an agent with no rule at all and the platform's rule in place, or an install with no Environments, shows the usual empty state and no Restore.
  it("shows the empty state when nothing was removed", () => {
    state.rules = [];
    state.platform = { state: "unavailable" };
    const doc = mount();
    expect(doc.body.textContent).toContain("No rules yet");
    expect(
      doc.querySelector('[data-testid="egress-platform-restore"]'),
    ).toBeNull();
    state.platform = { state: "removed", host: "*.env.example.com" };
  });
});
