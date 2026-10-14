import type { BudgetVmUsage } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  cpuBar,
  memoryBar,
  poolWarning,
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
const names = (bar: { segments: { label: string }[] }) =>
  bar.segments.map((s) => s.label.split(" · ")[0]);

describe("pool bars", () => {
  it("lists memory by running agents largest first, then headroom, adding up to the use", () => {
    const bar = memoryBar(usage, agents);
    expect(names(bar)).toEqual(["b", "a", "1 more", "Reserved for growth"]);
    expect(bar.segments.reduce((sum, s) => sum + s.fraction, 0)).toBeCloseTo(
      0.6,
    );
  });

  it("counts hibernated agents' storage, and keeps the server's level", () => {
    const bar = storageBar(usage, agents);
    expect(bar.level).toBe("critical");
    expect(names(bar)).toEqual([
      "b",
      "asleep",
      "a",
      "1 more",
      "Caches and system",
    ]);
  });

  it("fills the CPU bar with the server's congestion fill", () => {
    const bar = cpuBar({
      limitMilli: 4000,
      usedMilli: 4000,
      throttledPercent: 10,
      pressurePercent: 50,
      congestion: "high",
      level: "critical",
      fill: 0.5,
    });
    expect(bar).toEqual({
      level: "critical",
      segments: [
        {
          agentId: null,
          label: "High congestion",
          fraction: 0.5,
          filled: true,
        },
      ],
    });
  });

  it("names the agents using the most CPU", () => {
    expect(topCpuAgents(usage, agents).map((a) => a.id)).toEqual(["b", "a"]);
  });
});

describe("a pool's warning text", () => {
  const advice = "Pause agents to free up memory.";
  const fact = "Idle agents are paused automatically to make room.";

  it("adds what the platform does, and the Slack login for an unlinked user, only at critical", () => {
    // TEST_SCENARIO: warning shows the advice alone, even for an unlinked user; critical adds the fact, and the invite only with a login command.
    expect(poolWarning("warning", advice, fact, "/platform login")).toBe(
      advice,
    );
    expect(poolWarning("critical", advice, fact)).toBe(`${advice} ${fact}`);
    expect(poolWarning("critical", advice, fact, "/platform login")).toBe(
      `${advice} ${fact} Run /platform login in Slack to get alerts like this there.`,
    );
  });
});
