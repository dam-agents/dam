import type { BudgetVmUsage } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  memoryBar,
  storageBar,
  topCpuAgents,
} from "../../modules/budgets/lib/pools.js";
import type { AgentView } from "../../types.js";

/**
 * TEST_OVERVIEW: A pool bar lists each vm agent's share largest first, folds
 * shares too thin to see, and shows what the pool counts beyond the agents'
 * own shares as one last segment, so the segments always add up to the bar.
 */

const GiB = 1024 ** 3;

const agent = (id: string, state: AgentView["state"] = "running") =>
  ({ id, name: id, state, vm: true }) as AgentView;

const usage: BudgetVmUsage = {
  memory: { usedBytes: 6 * GiB, limitBytes: 10 * GiB, level: "ok" },
  storage: { usedBytes: 95 * GiB, usableBytes: 100 * GiB, level: "critical" },
  agents: [
    {
      id: "a",
      memoryUsedBytes: 1 * GiB,
      storageUsedBytes: 10 * GiB,
      cpuMilli: 100,
    },
    {
      id: "b",
      memoryUsedBytes: 3 * GiB,
      storageUsedBytes: 60 * GiB,
      cpuMilli: 900,
    },
    {
      id: "tiny",
      memoryUsedBytes: 0.01 * GiB,
      storageUsedBytes: 0.5 * GiB,
      cpuMilli: 0,
    },
    {
      id: "asleep",
      memoryUsedBytes: 1 * GiB,
      storageUsedBytes: 20 * GiB,
      cpuMilli: 0,
    },
  ],
  observedAt: "",
};

const agents = [
  agent("a"),
  agent("b"),
  agent("tiny"),
  agent("asleep", "hibernated"),
];

describe("pool bars", () => {
  it("lists memory by running agents largest first, then headroom", () => {
    const bar = memoryBar(usage, agents);
    expect(bar.percent).toBe(60);
    expect(bar.segments.map((s) => s.label)).toEqual([
      "b",
      "a",
      "1 more",
      "Headroom for your agents",
    ]);
    expect(bar.segments.reduce((sum, s) => sum + s.bytes, 0)).toBe(6 * GiB);
  });

  it("counts hibernated agents' storage, and keeps the server's level", () => {
    const bar = storageBar(usage, agents);
    expect(bar.level).toBe("critical");
    expect(bar.segments.map((s) => s.label)).toEqual([
      "b",
      "asleep",
      "a",
      "1 more",
      "Caches and system",
    ]);
  });

  it("names the agents using the most CPU", () => {
    expect(topCpuAgents(usage, agents).map((t) => t.agent.id)).toEqual([
      "b",
      "a",
    ]);
  });
});
