import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseRunnerUsage } from "../../modules/budgets/infrastructure/runner-usage.js";

/**
 * TEST_OVERVIEW: The runner writes its usage read in Rust and the api-server
 * reads it here, held together only by the golden documents beside the
 * runner, which the runner's own tests write and read. A field renamed on the
 * runner fails here rather than reading as unknown usage, which would quietly
 * refuse nothing.
 */

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../vm-runner/contract/${name}`, import.meta.url),
      "utf8",
    ),
  );

describe("the runner's usage read", () => {
  it("reads every field the runner writes", () => {
    const at = new Date("2026-10-13T12:00:00Z");
    expect(parseRunnerUsage(fixture("runner-usage.json"), at)).toEqual({
      storage: {
        usedBytes: 32212254720,
        usableBytes: 107374182400,
        seedBytes: 2147483648,
      },
      memory: { limitMiB: 12288, committedMiB: 3072 },
      cpu: {
        limitMilli: 9000,
        usedMilli: 1200,
        throttledPercent: 4,
        pressurePercent: 12,
      },
      machines: [
        {
          id: "agent-a",
          state: "running",
          usedMiB: 640,
          diskGiB: 100,
          diskUsedBytes: 8589934592,
          cpuMilli: 350,
          homeFull: true,
        },
      ],
      observedAt: at.toISOString(),
    });
  });

  it("reads the zero value the runner writes for a runner with nothing", () => {
    expect(
      parseRunnerUsage(fixture("runner-usage.zero.json"), new Date(0))
        ?.machines,
    ).toEqual([]);
  });
});
