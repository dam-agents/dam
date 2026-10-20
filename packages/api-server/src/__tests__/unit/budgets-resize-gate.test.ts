import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  configuredPool,
  createResizeGate,
  createBudgetsService,
  createStorageGate,
  type BudgetedAgent,
} from "../../modules/budgets/services/budgets-service.js";

// TEST_OVERVIEW: the pools the api-server judges a vm agent against: the install's, as the chart sizes it, and one owner's own.
const INSTALL = { storage: "20Gi", memory: "12Gi" };

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
  const noPool = {
    readConfiguredPool: async () => configuredPool(INSTALL, null),
  };

  it("refuses a vm create once storage is 90% used, with the figures", async () => {
    const gate = createStorageGate({
      readVmUsage: async () => usage(90, 100),
      ...noPool,
    });
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
      const gate = createStorageGate({
        readVmUsage: async () => read,
        ...noPool,
      });
      await expect(gate.assertCanCreateVm()).resolves.toBeUndefined();
    }
  });
});

describe("the pool a move is judged against (#5344)", () => {
  // TEST_SCENARIO: a runner that answered is the pool, in its own measured figures: what it has written and what its claim can hold.
  it("reads the runner's own figures where it answered", async () => {
    const gate = createStorageGate({
      readVmUsage: async () => usage(30, 100),
      readConfiguredPool: async () => configuredPool(INSTALL, null),
    });
    expect(await gate.readCapacity()).toEqual({
      storage: { usedBytes: 30 * 1024 ** 3, usableBytes: 100 * 1024 ** 3 },
      memory: { committedMiB: 3072, limitMiB: 12288 },
    });
  });

  // TEST_SCENARIO: an owner with no runner yet — their first move — is judged against the pool they are about to be created at, with nothing written to it, rather than against nothing at all.
  it("reads the install's pool when there is no runner to ask", async () => {
    const gate = createStorageGate({
      readVmUsage: async () => null,
      readConfiguredPool: async () => configuredPool(INSTALL, null),
    });
    expect(await gate.readCapacity()).toEqual({
      storage: { usedBytes: 0, usableBytes: 20 * 1024 ** 3 },
      memory: { committedMiB: 0, limitMiB: 12 * 1024 },
    });
  });
});

// TEST_SCENARIO: the owner's UserBudget replaces the install's pool, each field on its own, and a memory the install does not set is zero — which refuses no machine rather than every one.
describe("the configured pool", () => {
  it("takes the owner's sizes over the install's, field by field", () => {
    expect(
      configuredPool(INSTALL, { storage: "50Gi", memory: "64Gi" }),
    ).toEqual({
      storage: { usedBytes: 0, usableBytes: 50 * 1024 ** 3 },
      memory: { committedMiB: 0, limitMiB: 64 * 1024 },
    });
    expect(
      configuredPool(INSTALL, { memory: "64Gi" }).storage.usableBytes,
    ).toBe(20 * 1024 ** 3);
  });

  it("reads an unset memory as zero", () => {
    expect(
      configuredPool({ storage: "20Gi", memory: "" }, null).memory,
    ).toEqual({ committedMiB: 0, limitMiB: 0 });
  });
});
