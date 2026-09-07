import type { BudgetReserved } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  ceilingSlots,
  computeView,
  formatSizeLabel,
  freeSlots,
  sizeInMi,
  slotsFor,
  slotUnitOf,
} from "../../modules/budgets/lib/slots.js";
import type { AgentView } from "../../types.js";

const GI = 1024 ** 3;

const budget: BudgetReserved = {
  cpu: { reservedMilli: 3000, ceilingMilli: 8000 },
  memory: { reservedBytes: 6 * GI, ceilingBytes: 16 * GI },
  slot: { cpuMilli: 1000, memoryBytes: 2 * GI },
};
const unit = slotUnitOf(budget);

const agent = (
  id: string,
  size: AgentView["size"],
  state: AgentView["state"] = "running",
): AgentView => ({
  id,
  name: id,
  templateId: null,
  templateUpdate: null,
  features: { liveUpdates: true },
  kbTemplateId: null,
  image: "x:latest",
  hibernationTimeoutMin: 60,
  grantedSecretIds: [],
  grantedConnectionIds: [],
  stopRequested: false,
  overBudget: false,
  size,
  state,
  contributionFailures: [],
  channels: [],
  spawnedBy: null,
});

describe("slots", () => {
  it("counts an agent by its larger dimension, rounded up", () => {
    expect(slotsFor(sizeInMi({ cpu: "2", memory: "4Gi" }), unit)).toBe(2);
    expect(slotsFor(sizeInMi({ cpu: "500m", memory: "3Gi" }), unit)).toBe(2);
    expect(slotsFor(sizeInMi({ cpu: "1", memory: "1Gi" }), unit)).toBe(1);
    expect(slotsFor(sizeInMi({}), unit)).toBe(1);
  });

  it("derives ceiling and free slots from the binding dimension", () => {
    expect(ceilingSlots(budget, unit)).toBe(8);
    expect(freeSlots(budget, unit)).toBe(5);
    expect(freeSlots(budget, unit, sizeInMi({ cpu: "2", memory: "4Gi" }))).toBe(
      7,
    );
    expect(
      ceilingSlots(
        { ...budget, memory: { reservedBytes: 0, ceilingBytes: 6 * GI } },
        unit,
      ),
    ).toBe(3);
  });

  it("labels a size with its multiplier", () => {
    expect(formatSizeLabel(sizeInMi({ cpu: "2", memory: "4Gi" }), unit)).toBe(
      "2x · 2 CPU · 4 Gi",
    );
    expect(
      formatSizeLabel(sizeInMi({ cpu: "1500m", memory: "2Gi" }), unit),
    ).toBe("1.5x · 1.5 CPU · 2 Gi");
  });

  it("keeps the real ceiling when running agents exceed it", () => {
    const view = computeView(
      [agent("big", { cpu: "4", memory: "8Gi" })],
      new Set(),
      { ...budget, cpu: { reservedMilli: 4000, ceilingMilli: 2000 } },
    );
    expect(view.usedSlots).toBe(4);
    expect(view.ceilingSlots).toBe(2);
    expect(view.segments.map((s) => [s.state, s.slots])).toEqual([
      ["awake", 4],
    ]);
  });

  it("lays out working agents first, then awake, then free slots", () => {
    const view = computeView(
      [
        agent("idle", { cpu: "1", memory: "2Gi" }),
        agent("busy", { cpu: "2", memory: "4Gi" }),
      ],
      new Set(["busy"]),
      budget,
    );
    expect(view.segments.map((s) => [s.state, s.agentName, s.slots])).toEqual([
      ["running", "busy", 2],
      ["awake", "idle", 1],
      ["available", null, 5],
    ]);
    expect(view.usedSlots).toBe(3);
    expect(view.ceilingSlots).toBe(8);
    expect(view.totalSlots).toBe(8);
    expect(view.groups.map((g) => [g.state, g.agents, g.slots])).toEqual([
      ["running", 1, 2],
      ["awake", 1, 1],
    ]);
  });
});
