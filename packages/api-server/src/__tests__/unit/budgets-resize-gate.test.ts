import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  createResizeGate,
  createBudgetsService,
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
    });
    const reserved = await svc.reserved();
    expect(reserved.cpu).toEqual({ reservedMilli: 1500, ceilingMilli: 4000 });
    expect(reserved.memory).toEqual({
      reservedBytes: 1024 ** 3,
      ceilingBytes: 8 * 1024 ** 3,
    });
  });

  it("prefers the UserBudget override over the chart default", async () => {
    const svc = createBudgetsService({
      listAgents: async () => [],
      readCeilingOverride: async () => ({ cpu: "8", memory: "16Gi" }),
      defaultCeiling: { cpu: "4", memory: "8Gi" },
    });
    const reserved = await svc.reserved();
    expect(reserved.cpu.ceilingMilli).toBe(8000);
    expect(reserved.memory.ceilingBytes).toBe(16 * 1024 ** 3);
  });
});
