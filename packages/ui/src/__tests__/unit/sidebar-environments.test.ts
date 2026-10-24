// TEST_OVERVIEW: An agent's Environments in the sidebar, under the agent that owns them: a row each with its name and whether it runs, and a link to each endpoint's app that opens in a new tab; an endpoint without an address has no link. Nothing shows for an agent with no Environments, for a container agent, or while the feature is off.
import type { EnvironmentView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const state = vi.hoisted(() => ({
  environments: [] as unknown[],
  enabled: true,
  asked: [] as unknown[],
}));

vi.mock("@tanstack/react-query", () => ({
  skipToken: Symbol.for("skip"),
  useQuery: (options: { queryKey: unknown[] }) => {
    state.asked.push(options.queryKey[1]);
    return options.queryKey[1] === Symbol.for("skip")
      ? { data: undefined, isPending: true }
      : { data: state.environments, isPending: false };
  },
}));
vi.mock("../../trpc.js", () => ({
  trpc: {
    environments: {
      list: {
        queryOptions: (input: unknown) => ({ queryKey: ["list", input] }),
      },
      accessList: {
        queryOptions: (input: unknown) => ({ queryKey: ["access", input] }),
      },
    },
  },
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ navigateToSandboxHome: vi.fn() }),
}));
vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: { environments: state.enabled } }),
}));

const { SidebarEnvironments } =
  await import("../../modules/environments/components/sidebar-environments.js");

function render() {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidebarEnvironments, {
        agentId: "agent-dev",
        indent: "pl-12",
      }),
    ),
  );
}

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
    { name: "keycloak", port: 8080, url: null },
  ],
  access: null,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
  state: "running",
};

describe("the sidebar's Environments", () => {
  // TEST_SCENARIO: a running Environment shows under its agent with its name, that it runs, and a link to its app that opens in a new tab; the endpoint without an address has none.
  it("lists an agent's Environments with links to their apps", () => {
    state.enabled = true;
    state.environments = [environment];

    const html = render();

    expect(html).toContain('data-environment="pr-42"');
    expect(html).toContain("(running)");
    expect(html).toContain('href="https://app-pr-42-abcdef.env.example.com"');
    expect(html).toContain('target="_blank"');
    expect(html.match(/data-testid="sidebar-environment-link"/g)).toHaveLength(
      1,
    );
  });

  // TEST_SCENARIO: an agent with no Environments shows nothing, and a disabled feature does not even ask for them.
  it("shows nothing without Environments, and asks only while the feature is on", () => {
    state.enabled = true;
    state.environments = [];
    expect(render()).toBe("");

    state.enabled = false;
    state.asked = [];
    expect(render()).toBe("");
    expect(state.asked).toEqual([Symbol.for("skip")]);
  });
});
