import { describe, it, expect } from "vitest";
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
  storage: { usedBytes: 0, usableBytes: 100 },
  memory: { limitMiB: 1000, committedMiB: 100 },
  machines: [],
  observedAt: "2026-10-13T12:00:00.000Z",
  ...over,
});

describe("pool levels", () => {
  it("warns from 75% and is critical from 90%, on the floored percent", () => {
    expect(poolLevel(749, 1000)).toBe("ok");
    expect(poolLevel(750, 1000)).toBe("warning");
    expect(poolLevel(899, 1000)).toBe("warning");
    expect(poolLevel(900, 1000)).toBe("critical");
    expect(poolLevel(5, 0)).toBe("ok");
  });

  it("sets CPU pressure's levels lower, at 20% and 50%", () => {
    expect(cpuLevel(19)).toBe("ok");
    expect(cpuLevel(20)).toBe("warning");
    expect(cpuLevel(49)).toBe("warning");
    expect(cpuLevel(50)).toBe("critical");
  });

  it("refuses a new vm agent exactly when storage is critical", () => {
    for (const usedBytes of [89, 90, 100]) {
      const u = usage({ storage: { usedBytes, usableBytes: 100 } });
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
          },
          {
            id: "theirs",
            state: "running",
            usedMiB: 1,
            diskGiB: 100,
            diskUsedBytes: 1,
            cpuMilli: 1,
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
      },
    ]);
    expect(view.cpu).toEqual({
      limitMilli: 4000,
      usedMilli: 3900,
      throttledPercent: 20,
      pressurePercent: 55,
      level: "critical",
      slowed: true,
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
    ).toMatchObject({ pressurePercent: 25, level: "warning", slowed: true });
  });
});
