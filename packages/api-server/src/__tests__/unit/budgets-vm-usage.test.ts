import { describe, it, expect } from "vitest";
import { createBudgetsService } from "../../modules/budgets/services/budgets-service.js";
import {
  cpuLevel,
  poolLevel,
  storageRefusal,
  vmUsageView,
  type RunnerUsage,
} from "../../modules/budgets/domain/vm-usage.js";

/**
 * TEST_OVERVIEW: One definition of a pool's levels serves the home
 * dashboard's bars, the create refusal and the Slack alerts. These tests pin
 * where the levels fall, that the refusal and the critical level never
 * disagree, and what the budgets read publishes from a runner's answer.
 */

const usage = (over: Partial<RunnerUsage> = {}): RunnerUsage => ({
  storage: { usedBytes: 0, usableBytes: 100, seedBytes: 0 },
  memory: { limitMiB: 1000, committedMiB: 100 },
  machines: [],
  observedAt: "2026-10-13T12:00:00.000Z",
  ...over,
});

describe("pool levels", () => {
  it("warns from 75% and is critical from 90%", () => {
    expect(poolLevel(74)).toBe("ok");
    expect(poolLevel(75)).toBe("warning");
    expect(poolLevel(89)).toBe("warning");
    expect(poolLevel(90)).toBe("critical");
  });

  it("names CPU congestion by pressure and fills the bar by log slowdown, full at 4×", () => {
    const at = (p: number) => cpuLevel(p);
    expect(at(19)).toMatchObject({ congestion: "low", level: "ok" });
    expect(at(20)).toMatchObject({ congestion: "moderate", level: "warning" });
    expect(at(50)).toMatchObject({ congestion: "high", level: "critical" });
    expect(at(75)).toMatchObject({
      congestion: "severe",
      level: "critical",
      fill: 1,
    });
    expect(at(100).fill).toBe(1);
    expect(at(0).fill).toBe(0);
    expect(at(20).fill).toBeCloseTo(0.161, 3);
    expect(at(50).fill).toBeCloseTo(0.5, 6);
  });

  it("refuses a new vm agent exactly when storage is critical", () => {
    for (const usedBytes of [89, 90, 100]) {
      const u = usage({
        storage: {
          usedBytes,
          usableBytes: 100,
          seedBytes: 0,
        },
      });
      expect(storageRefusal(u) !== null).toBe(
        vmUsageView(u, new Set()).storage.level === "critical",
      );
    }
    expect(storageRefusal(null)).toBeNull();
  });
});

describe("the budgets read's vm figures", () => {
  it("lists only the caller's agents with their shares, and CPU only with a limit or a pressure", () => {
    const view = vmUsageView(
      usage({
        cpu: {
          limitMilli: 4000,
          usedMilli: 3900,
          throttledPercent: 20,
          pressurePercent: 55,
        },
        machines: [
          {
            id: "mine",
            state: "running",
            usedMiB: 2,
            diskGiB: 100,
            diskUsedBytes: 7,
            cpuMilli: 300,
            homeFull: true,
          },
          {
            id: "theirs",
            state: "running",
            usedMiB: 1,
            diskGiB: 100,
            diskUsedBytes: 1,
            cpuMilli: 1,
            homeFull: false,
          },
        ],
      }),
      new Set(["mine"]),
    );
    expect(view.agents).toEqual([
      {
        id: "mine",
        memoryUsedBytes: 2 * 1024 ** 2,
        storageUsedBytes: 7,
        cpuMilli: 300,
        homeFull: true,
      },
    ]);
    expect(view.cpu).toEqual({
      limitMilli: 4000,
      usedMilli: 3900,
      throttledPercent: 20,
      pressurePercent: 55,
      congestion: "high",
      level: "critical",
      fill: expect.closeTo(0.576, 3),
    });
    expect(
      vmUsageView(
        usage({
          cpu: { limitMilli: 0, usedMilli: 10, throttledPercent: 0 },
        }),
        new Set(),
      ).cpu,
    ).toBeUndefined();
    expect(
      vmUsageView(
        usage({
          cpu: { limitMilli: 4000, usedMilli: 10, throttledPercent: 25 },
        }),
        new Set(),
      ).cpu,
    ).toMatchObject({ pressurePercent: 25, congestion: "moderate" });
  });

  it("carries the owner's CPU pool and a machine's vCPUs beside the runner's figures", () => {
    // TEST_SCENARIO: the pool and the machine size are published when known and left out when unread or unset, so the UI falls back to the runner's limit.
    const runner = usage({
      cpu: { limitMilli: 9000, usedMilli: 6200, throttledPercent: 0 },
    });
    expect(
      vmUsageView(runner, new Set(), { poolMilli: 8000, machineMilli: 4000 })
        .cpu,
    ).toMatchObject({ limitMilli: 9000, poolMilli: 8000, machineMilli: 4000 });
    const unknown = vmUsageView(runner, new Set(), {
      poolMilli: null,
      machineMilli: null,
    }).cpu;
    expect(unknown).not.toHaveProperty("poolMilli");
    expect(unknown).not.toHaveProperty("machineMilli");
  });
});

describe("the Slack invite on the budgets read", () => {
  const read = (vm: RunnerUsage | null, unlinked: boolean) =>
    createBudgetsService({
      listAgentIds: async () => [],
      readVmUsage: async () => vm,
      readCpuPoolMilli: async () => 8000,
      machineMilli: null,
      isSlackUnlinked: async () => unlinked,
    }).reserved();

  it("marks vm usage only when the caller has no Slack link", async () => {
    // TEST_SCENARIO: a vm user without a Slack link is invited, a linked one and a user with no runner are not.
    expect((await read(usage(), true)).vm?.slackUnlinked).toBe(true);
    expect((await read(usage(), false)).vm).not.toHaveProperty("slackUnlinked");
    expect((await read(null, true)).vm).toBeUndefined();
  });

  it("still answers when the Slack link lookup fails", async () => {
    // TEST_SCENARIO: a failed identity lookup drops the invite, not the whole read.
    const view = await createBudgetsService({
      listAgentIds: async () => [],
      readVmUsage: async () => usage(),
      readCpuPoolMilli: async () => 8000,
      machineMilli: null,
      isSlackUnlinked: async () => {
        throw new Error("db down");
      },
    }).reserved();
    expect(view.vm).toBeDefined();
    expect(view.vm).not.toHaveProperty("slackUnlinked");
  });

  it("still answers when the budget read fails, without the pool", async () => {
    // TEST_SCENARIO: an unreadable UserBudget drops the CPU pool, not the whole read.
    const view = await createBudgetsService({
      listAgentIds: async () => [],
      readVmUsage: async () =>
        usage({
          cpu: { limitMilli: 9000, usedMilli: 10, throttledPercent: 0 },
        }),
      readCpuPoolMilli: async () => {
        throw new Error("store down");
      },
      machineMilli: 4000,
      isSlackUnlinked: async () => false,
    }).reserved();
    expect(view.vm?.cpu).toMatchObject({
      limitMilli: 9000,
      machineMilli: 4000,
    });
    expect(view.vm?.cpu).not.toHaveProperty("poolMilli");
  });
});
