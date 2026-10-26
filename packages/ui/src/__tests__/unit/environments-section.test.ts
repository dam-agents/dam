// TEST_OVERVIEW: An agent's Environments section, as its owner sees it: each Environment's name, whether it runs, its expiry, who may open it, and each endpoint's address as a link; an install without an environments domain says the endpoint has no address; with none yet, the section says the agent creates them. The owner's list of people shows above, with the owner always allowed.
import type { EnvironmentView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const state = vi.hoisted(() => ({
  environments: [] as unknown[],
  accessList: [] as string[],
}));

vi.mock("@tanstack/react-query", () => ({
  skipToken: Symbol(),
  useQuery: (options: { queryKey: string[] }) => {
    const key = options.queryKey[0];
    if (key === "environments.list")
      return { data: state.environments, isPending: false, isError: false };
    if (key === "environments.accessList")
      return { data: state.accessList, isPending: false, isError: false };
    return { data: undefined, isPending: false, isError: false };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../trpc.js", () => {
  const procedure = (name: string) => ({
    queryOptions: () => ({ queryKey: [name] }),
    mutationOptions: () => ({}),
    queryKey: () => [name],
  });
  return {
    trpc: {
      environments: {
        list: procedure("environments.list"),
        accessList: procedure("environments.accessList"),
        extend: procedure("environments.extend"),
        delete: procedure("environments.delete"),
        setAccessList: procedure("environments.setAccessList"),
        pathKey: () => ["environments"],
      },
      connections: {
        list: procedure("connections.list"),
        getAgentConnections: procedure("connections.getAgentConnections"),
      },
      agents: { get: procedure("agents.get") },
    },
  };
});
vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../../query-client.js", () => ({ queryClient: {} }));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ showConfirm: vi.fn() }),
}));
vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: { environments: true } }),
}));

const { EnvironmentsSection } =
  await import("../../modules/environments/components/environments-section.js");

function render() {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EnvironmentsSection, {
        agentId: "agent-dev",
        header: () => null,
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
  access: ["reviewer@example.com"],
  expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
  state: "hibernated",
  nesting: null,
};

describe("the Environments section", () => {
  // TEST_SCENARIO: an Environment shows its name, that it is not running, when it expires, how many of the owner's list may open it, and each endpoint's address as a link; an endpoint without an address says why.
  it("lists an Environment with its links, state and expiry", () => {
    state.environments = [environment];
    state.accessList = ["reviewer@example.com", "qa@example.com"];

    const html = render();

    expect(html).toContain("pr-42");
    expect(html).toContain("Not running");
    expect(html).toContain("Expires in 3");
    expect(html).toContain("1 of your list may open it");
    expect(html).toContain('href="https://app-pr-42-abcdef.env.example.com"');
    expect(html).toContain("No address: this install serves no Environments.");
    expect(html).toContain("reviewer@example.com");
    expect(html).toContain("2 / 50 people on the list");
  });

  // TEST_SCENARIO: an agent with no Environments says that the agent creates them, and that only the owner may open them while the list is empty.
  it("says the agent creates Environments when there are none", () => {
    state.environments = [];
    state.accessList = [];

    const html = render();

    expect(html).toContain(
      "The agent creates one with its create_environment tool",
    );
    expect(html).toContain("Only you can open this agent&#x27;s Environments.");
  });
});
