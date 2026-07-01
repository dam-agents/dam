import { describe, it, expect } from "vitest";
import { createHarnessConfigService } from "../../modules/harness-config/services/harness-config-service.js";
import { harnessConfigSupported } from "../../modules/harness-config/index.js";

type BumpCall = { agentId: string; events: unknown[] };

function makeService(opts?: {
  owned?: boolean;
  settled?: boolean;
  capabilities?: unknown;
}) {
  const calls = { bumps: [] as BumpCall[], enqueues: [] as string[] };
  const service = createHarnessConfigService({
    runtimeMutator: {
      bump: async (agentId, events) => {
        calls.bumps.push({ agentId, events });
        return 1;
      },
      enqueueAfterCommit: async (agentId) => {
        calls.enqueues.push(agentId);
      },
    },
    isOwnedAgent: async () => opts?.owned ?? true,
    getCapabilities: async () => opts?.capabilities,
    isSettled: async () => opts?.settled ?? true,
    now: () => 1000,
  });
  return { service, calls };
}

describe("harness-config service", () => {
  it("fires a one-shot harness-config event carrying the change, then enqueues", async () => {
    const { service, calls } = makeService();
    await service.apply("a1", { model: "opus", unset: ["mode"] });
    expect(calls.bumps).toHaveLength(1);
    expect(calls.bumps[0]!.agentId).toBe("a1");
    expect(calls.bumps[0]!.events).toEqual([
      {
        id: "harness-config:a1:1000",
        kind: "harness-config",
        payload: { model: "opus", unset: ["mode"] },
        expiresAt: new Date(1000 + 30 * 24 * 60 * 60 * 1000),
      },
    ]);
    expect(calls.enqueues).toEqual(["a1"]);
  });

  it("rejects apply for an agent the caller doesn't own (no event fired)", async () => {
    const { service, calls } = makeService({ owned: false });
    await expect(service.apply("a1", { model: "opus" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(calls.bumps).toHaveLength(0);
    expect(calls.enqueues).toHaveLength(0);
  });

  it("rejects settled for an agent the caller doesn't own", async () => {
    const { service } = makeService({ owned: false });
    await expect(service.settled("a1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("status maps the agent's advertised harnessConfig capability", async () => {
    expect(
      await makeService({
        capabilities: { harnessConfig: true },
      }).service.status("a1"),
    ).toEqual({ supported: true, catalog: null });
    expect(
      await makeService({
        capabilities: { harnessConfig: false },
      }).service.status("a1"),
    ).toEqual({ supported: false, catalog: null });
    // Unknown capabilities (agent not booted) → optimistically supported.
    expect(
      await makeService({ capabilities: null }).service.status("a1"),
    ).toEqual({ supported: true, catalog: null });
  });

  it("status returns the option catalog advertised on hello", async () => {
    const catalog = {
      options: [
        {
          id: "model",
          name: "Model",
          category: "model",
          choices: [{ value: "sonnet", name: "Sonnet" }],
        },
      ],
    };
    expect(
      await makeService({
        capabilities: { harnessConfig: true, harnessConfigCatalog: catalog },
      }).service.status("a1"),
    ).toEqual({ supported: true, catalog });
  });

  it("rejects status for an agent the caller doesn't own", async () => {
    const { service } = makeService({ owned: false });
    await expect(service.status("a1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("harnessConfigSupported", () => {
  it("treats unknown capabilities as supported (agent not booted yet)", () => {
    expect(harnessConfigSupported(null)).toBe(true);
    expect(harnessConfigSupported(undefined)).toBe(true);
  });

  it("is true only when the agent advertises the harnessConfig flag", () => {
    expect(harnessConfigSupported({ harnessConfig: true })).toBe(true);
    expect(harnessConfigSupported({ harnessConfig: false })).toBe(false);
    expect(harnessConfigSupported({ contributions: [], events: [] })).toBe(
      false,
    );
  });
});
