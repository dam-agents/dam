// TEST_OVERVIEW: the home dashboard's CPU row reads as how much of the owner's CPU pool their agents use, like memory, while congestion stays its warning: the sign appears from moderate congestion up, naming the heaviest agents, and also when one agent uses all the vCPUs its machine gets.
import type { BudgetVmUsage } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ navigateToSandboxHome: vi.fn() }),
}));

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { CpuRow } from "../../modules/budgets/components/cpu-row.js";
import type { AgentView } from "../../types.js";

const agents = [
  { id: "a", name: "builder", state: "running" },
  { id: "b", name: "writer", state: "running" },
] as AgentView[];

function html(
  over: Partial<NonNullable<BudgetVmUsage["cpu"]>> = {},
  shares = [3900, 300],
) {
  const cpu: NonNullable<BudgetVmUsage["cpu"]> = {
    limitMilli: 9000,
    usedMilli: 6200,
    poolMilli: 8000,
    machineMilli: 4000,
    throttledPercent: 0,
    pressurePercent: 5,
    congestion: "low",
    level: "ok",
    fill: 0.04,
    ...over,
  };
  const usage: BudgetVmUsage = {
    memory: { usedBytes: 0, limitBytes: 1, level: "ok" },
    storage: { usedBytes: 0, usableBytes: 1, seedBytes: 0, level: "ok" },
    cpu,
    agents: agents.map((agent, i) => ({
      id: agent.id,
      memoryUsedBytes: 0,
      storageUsedBytes: 0,
      cpuMilli: shares[i] ?? 0,
    })),
    observedAt: "",
  };
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(CpuRow, { cpu, usage, agents }),
    ),
  );
}

describe("CpuRow", () => {
  it("shows use of the pool, and congestion only in the meter's spoken value while it is low", () => {
    // TEST_SCENARIO: 6.2 of 8 CPU with low congestion and no agent at its ceiling: no warning sign.
    const out = html({}, [2000, 300]);
    expect(out).toContain("6.2 of 8 CPU");
    expect(out).toContain('aria-valuetext="6.2 of 8 CPU, Low congestion"');
    expect(out).toContain('aria-valuenow="77"');
    expect(out).not.toContain("slowed down");
    expect(out).not.toContain("one agent can get");
  });

  it("warns from moderate congestion, naming the heaviest agents", () => {
    const out = html(
      { congestion: "moderate", level: "warning", pressurePercent: 30 },
      [2000, 300],
    );
    expect(out).toContain(
      "Moderate congestion: your agents may be slowed down by waiting for CPU. Heaviest users: builder, writer.",
    );
  });

  it("warns about an agent at its own machine's vCPUs while congestion is low", () => {
    // TEST_SCENARIO: builder uses 3.9 of its machine's 4 vCPUs: the sign appears, naming it, though the pool has room.
    const out = html();
    expect(out).toContain(
      "builder is using all the CPU one agent can get, so it may be slow.",
    );
    expect(out).not.toContain("slowed down by waiting");
  });

  it("falls back to the congestion word when there is no pool to measure against", () => {
    const out = html({ poolMilli: undefined, limitMilli: 0 }, [0, 0]);
    expect(out).toContain('aria-valuetext="Low congestion"');
    expect(out).not.toContain(" of ");
  });
});
