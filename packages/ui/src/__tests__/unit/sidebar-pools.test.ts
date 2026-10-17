import type { BudgetReserved } from "api-server-api";
import { describe, expect, it } from "vitest";

import { sidebarPools } from "../../modules/budgets/lib/sidebar-pools.js";
import type { AgentView } from "../../types.js";

/**
 * TEST_OVERVIEW: The sidebar's memory and storage pools break their use down
 * by agent, largest first, from the vm runner's report when there is one and
 * from the awake container agents' sizes when there is not.
 */

const GiB = 1024 ** 3;
const container = {
  cpu: { reservedMilli: 0, ceilingMilli: 4000 },
  memory: { reservedBytes: 6 * GiB, ceilingBytes: 16 * GiB },
  slot: { cpuMilli: 500, memoryBytes: GiB },
};

const agent = (id: string, extra: Partial<AgentView> = {}) =>
  ({ id, name: id, state: "running", ...extra }) as AgentView;

describe("sidebarPools", () => {
  // TEST_SCENARIO: with a vm report, each pool lists the agents the runner measured, largest first, and names the runner's own storage beside them.
  it("breaks vm memory and storage down by agent", () => {
    const budget: BudgetReserved = {
      ...container,
      vm: {
        memory: { usedBytes: 5 * GiB, limitBytes: 10 * GiB, level: "ok" },
        storage: {
          usedBytes: 40 * GiB,
          usableBytes: 100 * GiB,
          imageCacheBytes: 4 * GiB,
          seedBytes: 0,
          level: "ok",
        },
        agents: [
          {
            id: "a",
            memoryUsedBytes: 1 * GiB,
            storageUsedBytes: 30 * GiB,
            cpuMilli: 0,
          },
          {
            id: "b",
            memoryUsedBytes: 3 * GiB,
            storageUsedBytes: 2 * GiB,
            cpuMilli: 0,
          },
          { id: "idle", memoryUsedBytes: 0, storageUsedBytes: 0, cpuMilli: 0 },
        ],
        observedAt: "2026-10-17T00:00:00Z",
      },
    };
    const [memory, storage] = sidebarPools(budget, [
      agent("a", { vm: true } as Partial<AgentView>),
      agent("b", { vm: true } as Partial<AgentView>),
      agent("idle", { vm: true } as Partial<AgentView>),
    ]);
    expect(memory!.rows.map((r) => [r.label, r.bytes])).toEqual([
      ["b", 3 * GiB],
      ["a", 1 * GiB],
    ]);
    expect(storage!.rows.map((r) => r.label)).toEqual([
      "a",
      "Image cache",
      "Logs and system",
      "b",
    ]);
    expect(storage!.totalBytes).toBe(100 * GiB);
  });

  // TEST_SCENARIO: without a vm report, memory falls back to the awake container agents' reserved sizes, skipping hibernated ones, and storage has nothing to show.
  it("falls back to container sizes and leaves storage empty", () => {
    const [memory, storage] = sidebarPools(container, [
      agent("small", { size: { memory: "1Gi" } } as Partial<AgentView>),
      agent("big", { size: { memory: "4Gi" } } as Partial<AgentView>),
      agent("asleep", {
        state: "hibernated",
        size: { memory: "8Gi" },
      } as Partial<AgentView>),
    ]);
    expect(memory!.rows.map((r) => [r.label, r.bytes])).toEqual([
      ["big", 4 * GiB],
      ["small", 1 * GiB],
    ]);
    expect(memory!.totalBytes).toBe(16 * GiB);
    expect(storage!.totalBytes).toBe(0);
    expect(storage!.rows).toEqual([]);
  });
});
