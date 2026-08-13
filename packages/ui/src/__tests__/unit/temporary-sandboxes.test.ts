import { describe, expect, test } from "vitest";

import {
  formatTemporaryDraw,
  splitTemporarySandboxes,
} from "../../modules/agents/utils/temporary-sandboxes.js";
import type { AgentView } from "../../types.js";

const agent = (id: string, overrides: Partial<AgentView> = {}): AgentView => ({
  id,
  name: id,
  templateId: null,
  templateUpdate: null,
  kbTemplateId: null,
  image: "x:latest",
  hibernationTimeoutMin: 60,
  grantedSecretIds: [],
  grantedConnectionIds: [],
  stopRequested: false,
  overBudget: false,
  size: { cpu: "1", memory: "2Gi" },
  state: "running",
  contributionFailures: [],
  channels: [],
  spawnedBy: null,
  ...overrides,
});

describe("splitTemporarySandboxes", () => {
  test("hides targets and attributes their live compute to the driver", () => {
    const { visible, drawByDriver } = splitTemporarySandboxes([
      agent("driver"),
      agent("t1", {
        spawnedBy: "driver",
        size: { cpu: "500m", memory: "1Gi" },
      }),
      agent("t2", { spawnedBy: "driver", size: { cpu: "2", memory: "3Gi" } }),
      agent("plain"),
    ]);
    expect(visible.map((a) => a.id)).toEqual(["driver", "plain"]);
    expect(drawByDriver.get("driver")).toEqual({
      count: 2,
      cpuMilli: 2500,
      memoryMi: 4096,
    });
  });

  test("hides a hibernated target but keeps it out of the draw", () => {
    const { visible, drawByDriver } = splitTemporarySandboxes([
      agent("driver"),
      agent("t1", { spawnedBy: "driver", state: "hibernated" }),
    ]);
    expect(visible.map((a) => a.id)).toEqual(["driver"]);
    expect(drawByDriver.size).toBe(0);
  });

  test("counts a starting target — its pod is already reserving compute", () => {
    const { drawByDriver } = splitTemporarySandboxes([
      agent("t1", { spawnedBy: "driver", state: "starting" }),
    ]);
    expect(drawByDriver.get("driver")?.count).toBe(1);
  });

  test("tolerates a size nothing reported", () => {
    const { drawByDriver } = splitTemporarySandboxes([
      agent("t1", { spawnedBy: "driver", size: {} }),
    ]);
    expect(drawByDriver.get("driver")).toEqual({
      count: 1,
      cpuMilli: 0,
      memoryMi: 0,
    });
  });
});

describe("formatTemporaryDraw", () => {
  test("formats cores and Gi, trimming integer decimals", () => {
    expect(
      formatTemporaryDraw({ count: 2, cpuMilli: 2500, memoryMi: 4096 }),
    ).toBe("using 2.5 cores, 4 Gi");
    expect(
      formatTemporaryDraw({ count: 1, cpuMilli: 1000, memoryMi: 512 }),
    ).toBe("using 1 core, 0.5 Gi");
  });

  test("omits dimensions nothing reported", () => {
    expect(formatTemporaryDraw({ count: 1, cpuMilli: 0, memoryMi: 0 })).toBe(
      "",
    );
  });
});
