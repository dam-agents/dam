// TEST_OVERVIEW: JanUI's Environments tab of an agent's chat side panel lists that agent's Environments as the cards of its Environments section — name, whether it runs, expiry, a link per endpoint that opens in a new tab, and the owner's extend and delete controls — and edits who may open them in place, above the cards. The tab shows only once the agent owns one, so it shows Loading while another agent's list arrives.
import type { EnvironmentView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const state = vi.hoisted(() => ({
  environments: [] as unknown[],
  pending: false,
  asked: [] as unknown[],
}));

vi.mock("../../modules/environments/api/queries.js", () => ({
  useEnvironments: (agentId: string | null) => {
    state.asked.push(agentId);
    return {
      data: state.pending ? undefined : state.environments,
      isPending: state.pending,
    };
  },
  useEnvironmentAccessList: () => ({ data: [], isPending: false }),
}));
vi.mock("../../modules/environments/api/mutations.js", () => ({
  useExtendEnvironment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEnvironment: () => ({ mutate: vi.fn(), isPending: false }),
  useSetEnvironmentAccessList: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ navigateToSandboxHome: vi.fn(), showConfirm: vi.fn() }),
}));

const { EnvironmentsPanel } =
  await import("../../modules/environments/components/environments-panel.js");

const render = () =>
  renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EnvironmentsPanel, { agentId: "agent-dev" }),
    ),
  );

const environment: EnvironmentView = {
  id: "agent-env1",
  owningAgentId: "agent-dev",
  name: "pr-42",
  endpoints: [
    {
      name: "app",
      port: 4444,
      url: "https://app-pr-42-abcdef.env.example.com",
    },
  ],
  access: null,
  expiresAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
  state: "running",
};

// TEST_SCENARIO: a running Environment shows as its card, with that it runs, its expiry, its app's link opening in a new tab, and the menu with the extend and delete controls; the tab asks for that agent's Environments and links to its section.
it("lists the agent's Environments as their cards", () => {
  state.environments = [environment];
  state.asked = [];
  const html = render();
  expect(state.asked).toEqual(["agent-dev"]);
  expect(html).toContain('data-testid="environment-card"');
  expect(html).toContain('data-environment="pr-42"');
  expect(html).toContain("Running");
  expect(html).toContain("Expires in");
  expect(html).toContain('href="https://app-pr-42-abcdef.env.example.com"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('aria-label="Actions for pr-42"');
  expect(html).toContain('data-testid="environment-access"');
});

// TEST_SCENARIO: switching to another vm agent's chat keeps the tab open while that agent's list arrives, so the panel says it is loading rather than closing and reopening.
it("says Loading while the agent's Environments arrive", () => {
  state.pending = true;
  const html = render();
  expect(html).toContain("Loading…");
  expect(html).not.toContain('data-testid="environment-card"');
  state.pending = false;
});
