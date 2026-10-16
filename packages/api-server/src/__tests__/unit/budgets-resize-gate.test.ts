import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  createResizeGate,
  createBudgetsService,
  createStorageGate,
  type BudgetedAgent,
} from "../../modules/budgets/services/budgets-service.js";

function agent(
  id: string,
  limits: { cpu?: string; memory?: string },
  flags: Partial<Pick<BudgetedAgent, "hibernated" | "overBudget">> = {},
): BudgetedAgent {
  return {
    id,
    spec: { resources: { limits: limits as Record<string, string> } },
    hibernated: flags.hibernated ?? false,
    overBudget: flags.overBudget ?? false,
  };
}

function gate(agents: BudgetedAgent[], ceiling = { cpu: "4", memory: "8Gi" }) {
  return createResizeGate({
    listAgents: async () => agents,
    readCeilingOverride: async () => null,
    defaultCeiling: ceiling,
  });
}

describe("resize gate (#1900)", () => {
  it("admits an increase that fits the ceiling", async () => {
    const me = agent("me", { cpu: "1", memory: "1Gi" });
    const peers = [me, agent("peer", { cpu: "2", memory: "2Gi" })];
    await expect(
      gate(peers).assertResizeFits(me, { cpu: "2", memory: "2Gi" }),
    ).resolves.toBeUndefined();
  });

  it("rejects an increase past the ceiling with the figures", async () => {
    const me = agent("me", { cpu: "1", memory: "1Gi" });
    const peers = [me, agent("peer", { cpu: "3", memory: "6Gi" })];
    const err = await gate(peers)
      .assertResizeFits(me, { cpu: "2", memory: "1Gi" })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).message).toContain("5.0 CPU/4.0 CPU");
  });

  it("always admits a shrink — even for an owner already over the ceiling", async () => {
    const me = agent("me", { cpu: "4", memory: "4Gi" });
    const peers = [me, agent("peer", { cpu: "4", memory: "8Gi" })];
    await expect(
      gate(peers).assertResizeFits(me, { cpu: "1", memory: "1Gi" }),
    ).resolves.toBeUndefined();
  });

  it("fills a partial size from the agent's current limits", async () => {
    const me = agent("me", { cpu: "1", memory: "1Gi" });
    const peers = [me, agent("peer", { cpu: "3", memory: "1Gi" })];
    await expect(
      gate(peers).assertResizeFits(me, { memory: "4Gi" }),
    ).resolves.toBeUndefined();
  });

  it("excludes hibernated and parked peers from Reserved", async () => {
    const me = agent("me", { cpu: "1", memory: "1Gi" });
    const peers = [
      me,
      agent("sleeping", { cpu: "4", memory: "8Gi" }, { hibernated: true }),
      agent("parked", { cpu: "4", memory: "8Gi" }, { overBudget: true }),
    ];
    await expect(
      gate(peers).assertResizeFits(me, { cpu: "4", memory: "8Gi" }),
    ).resolves.toBeUndefined();
  });
});

describe("budgets meter (#1900)", () => {
  it("sums only up agents' limits and parses the ceiling", async () => {
    const svc = createBudgetsService({
      listAgents: async () => [
        agent("up", { cpu: "1500m", memory: "1Gi" }),
        agent("sleeping", { cpu: "4", memory: "8Gi" }, { hibernated: true }),
        agent("parked", { cpu: "4", memory: "8Gi" }, { overBudget: true }),
      ],
      readCeilingOverride: async () => null,
      defaultCeiling: { cpu: "4", memory: "8Gi" },
      slotSize: { cpu: "1", memory: "2Gi" },
      readVmUsage: async () => null,
      isSlackUnlinked: async () => false,
    });
    const reserved = await svc.reserved();
    expect(reserved.cpu).toEqual({ reservedMilli: 1500, ceilingMilli: 4000 });
    expect(reserved.memory).toEqual({
      reservedBytes: 1024 ** 3,
      ceilingBytes: 8 * 1024 ** 3,
    });
    expect(reserved.slot).toEqual({
      cpuMilli: 1000,
      memoryBytes: 2 * 1024 ** 3,
    });
  });

  it("leaves vm agents out: they draw on their owner's runner", async () => {
    const svc = createBudgetsService({
      listAgents: async () => [
        agent("up", { cpu: "1", memory: "1Gi" }),
        {
          ...agent("vm", { cpu: "4", memory: "8Gi" }),
          spec: {
            resources: { limits: { cpu: "4", memory: "8Gi" } },
            backend: { type: "vm" },
          },
        },
      ],
      readCeilingOverride: async () => null,
      defaultCeiling: { cpu: "4", memory: "8Gi" },
      slotSize: { cpu: "1", memory: "2Gi" },
      readVmUsage: async () => null,
      isSlackUnlinked: async () => false,
    });
    const reserved = await svc.reserved();
    expect(reserved.cpu.reservedMilli).toBe(1000);
    expect(reserved.memory.reservedBytes).toBe(1024 ** 3);
    expect(reserved.vm).toBeUndefined();
  });

  it("publishes the runner's use, listing only the caller's own vm agents", async () => {
    const svc = createBudgetsService({
      listAgents: async () => [
        {
          ...agent("vm", { cpu: "4", memory: "8Gi" }),
          spec: { backend: { type: "vm" } },
        },
      ],
      readCeilingOverride: async () => null,
      defaultCeiling: { cpu: "4", memory: "8Gi" },
      slotSize: { cpu: "1", memory: "2Gi" },
      readVmUsage: async () => usage(30, 100),
      isSlackUnlinked: async () => false,
    });
    const { vm } = await svc.reserved();
    expect(vm).toEqual({
      memory: {
        usedBytes: 3072 * 1024 ** 2,
        limitBytes: 12288 * 1024 ** 2,
        level: "ok",
      },
      storage: {
        usedBytes: 30 * 1024 ** 3,
        usableBytes: 100 * 1024 ** 3,
        imageCacheBytes: 0,
        seedBytes: 0,
        level: "ok",
      },
      agents: [
        {
          id: "vm",
          memoryUsedBytes: 640 * 1024 ** 2,
          storageUsedBytes: 0,
          cpuMilli: 0,
        },
      ],
      observedAt: "2026-10-13T12:00:00.000Z",
    });
  });

  it("prefers the UserBudget override over the chart default", async () => {
    const svc = createBudgetsService({
      listAgents: async () => [],
      readCeilingOverride: async () => ({ cpu: "8", memory: "16Gi" }),
      defaultCeiling: { cpu: "4", memory: "8Gi" },
      slotSize: { cpu: "1", memory: "2Gi" },
      readVmUsage: async () => null,
      isSlackUnlinked: async () => false,
    });
    const reserved = await svc.reserved();
    expect(reserved.cpu.ceilingMilli).toBe(8000);
    expect(reserved.memory.ceilingBytes).toBe(16 * 1024 ** 3);
  });

  it("falls back to the chart default for a field the UserBudget leaves out", async () => {
    const svc = createBudgetsService({
      listAgents: async () => [],
      readCeilingOverride: async () => ({ cpu: "8" }),
      defaultCeiling: { cpu: "4", memory: "8Gi" },
      slotSize: { cpu: "1", memory: "2Gi" },
      readVmUsage: async () => null,
      isSlackUnlinked: async () => false,
    });
    const reserved = await svc.reserved();
    expect(reserved.cpu.ceilingMilli).toBe(8000);
    expect(reserved.memory.ceilingBytes).toBe(8 * 1024 ** 3);
  });
});

function usage(usedGi: number, usableGi: number) {
  return {
    storage: {
      usedBytes: usedGi * 1024 ** 3,
      usableBytes: usableGi * 1024 ** 3,
      imageCacheBytes: 0,
      seedBytes: 0,
    },
    memory: { limitMiB: 12288, committedMiB: 3072 },
    machines: [
      {
        id: "vm",
        state: "running",
        usedMiB: 640,
        diskGiB: 100,
        diskUsedBytes: 0,
        cpuMilli: 0,
      },
      {
        id: "someone-elses",
        state: "running",
        usedMiB: 900,
        diskGiB: 100,
        diskUsedBytes: 0,
        cpuMilli: 0,
      },
    ],
    observedAt: "2026-10-13T12:00:00.000Z",
  };
}

describe("storage gate (#4757)", () => {
  it("refuses a vm create once storage is 90% used, with the figures", async () => {
    const gate = createStorageGate({ readVmUsage: async () => usage(90, 100) });
    await expect(gate.assertCanCreateVm()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: {
        storageFull: {
          usedBytes: 90 * 1024 ** 3,
          usableBytes: 100 * 1024 ** 3,
          percent: 90,
        },
      },
    });
  });

  it("refuses nothing below 90%, nor on unknown or unmeasured use", async () => {
    for (const read of [usage(89, 100), null, usage(0, 0)]) {
      const gate = createStorageGate({ readVmUsage: async () => read });
      await expect(gate.assertCanCreateVm()).resolves.toBeUndefined();
    }
  });
});
