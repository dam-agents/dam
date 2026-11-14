// @vitest-environment happy-dom
// TEST_OVERVIEW: Home keeps the pool card off the page until a pool is near full.
// TEST_OVERVIEW: An agent's own full home counts too, and the spend card shows either way.
// TEST_OVERVIEW: The card's frame and the two-column grid follow the gate, so the page has no empty column while both pools have room.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BudgetVmUsage } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const state = vi.hoisted(() => ({ usage: undefined as unknown }));

vi.mock("../../modules/agents/hooks/use-agent-rows.js", () => ({
  useAgentRows: () => ({
    agentsData: { list: [{ id: "a", name: "Agent A", state: "running" }] },
    initialLoaded: true,
    rowProps: {},
  }),
}));
vi.mock("../../modules/agents/utils/temporary-sandboxes.js", () => ({
  splitTemporarySandboxes: (agents: readonly unknown[]) => ({
    visible: agents,
    temporaryCountByDriver: {},
  }),
}));
vi.mock("../../modules/home/api/queries.js", () => ({
  useFeed: () => ({ items: [], workingByAgent: new Map() }),
  useAttention: () => ({ data: { items: [] } }),
}));
vi.mock("../../modules/agents/components/sandbox-list.js", () => ({
  SandboxList: () => null,
}));
vi.mock("../../modules/budgets/api/queries.js", () => ({
  usePoolUsage: () => ({ data: state.usage }),
}));
vi.mock("../../modules/links/api/queries.js", () => ({
  useComputeRequestUrl: () => null,
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ navigateToSandboxHome: () => {} }),
}));

const { HomeView } = await import("../../modules/home/views/home-view.js");

const usage: BudgetVmUsage = {
  memory: { usedBytes: 6_000_000_000, limitBytes: 20_000_000_000, level: "ok" },
  storage: {
    usedBytes: 6_000_000_000,
    usableBytes: 40_000_000_000,
    seedBytes: 0,
    level: "ok",
  },
  agents: [
    {
      id: "a",
      memoryUsedBytes: 6_000_000_000,
      storageUsedBytes: 6_000_000_000,
      cpuMilli: 100,
      homeFull: false,
    },
  ],
  observedAt: "",
};

function home(usageNow: BudgetVmUsage | undefined): string {
  state.usage = usageNow;
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(TooltipProvider, null, createElement(HomeView)),
    ),
  );
}

describe("Home's pool card", () => {
  // TEST_SCENARIO: both pools have room, so the card is not there and the spend card takes the page.
  it("is absent, and the grid keeps one column, while every pool has room", () => {
    const markup = home(usage);
    expect(markup).not.toContain("Memory");
    expect(markup).not.toContain("@3xl:grid-cols-2");
  });

  // TEST_SCENARIO: storage is near full, so the card names the pools and sits beside the spend card.
  it("appears beside the spend card when a pool is near full", () => {
    const markup = home({
      ...usage,
      storage: { ...usage.storage, level: "warning" },
    });
    expect(markup).toContain("Memory");
    expect(markup).toContain("@3xl:grid-cols-2");
  });

  it("appears when an agent's own home is full", () => {
    const markup = home({
      ...usage,
      agents: usage.agents.map((share) => ({ ...share, homeFull: true })),
    });
    expect(markup).toContain("Memory");
  });

  // TEST_SCENARIO: the usage record has not loaded, so Home shows neither the card nor a claim about the pools.
  it("is absent while the usage record has not loaded", () => {
    expect(home(undefined)).not.toContain("Memory");
  });
});
