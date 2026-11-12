import { describe, expect, test, vi } from "vitest";

import {
  driverStopReason,
  stoppedOf,
  userStopReason,
} from "../../modules/invocations/domain/stop-reason.js";
import type { InvocationRow } from "../../modules/invocations/infrastructure/invocations-repository.js";
import { createInvocationsService } from "../../modules/invocations/services/invocations-service.js";
import {
  fakeInvocationsRepo,
  invocationRow,
} from "../helpers/invocations-repo.js";

function makeService(rows: InvocationRow[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const stop = vi.fn(async () => ({ stopped: true }));
  const running = vi.fn(async () => true);
  const service = createInvocationsService({
    owner: "owner-1",
    repo: fakeInvocationsRepo({ get: async (id) => byId.get(id) ?? null }),
    agents: {} as never,
    driverResolution: { resolveRoot: async (id: string) => id },
    reaper: { reap: async () => {} },
    stopper: { stop, running },
    reportedReap: { afterReport: () => {} },
    cancel: { settled: async () => true },
    runtimeMutator: {} as never,
    wakeAgent: async () => {},
    readHarnessConfigSupport: async () => null,
    scriptOutputsAvailable: true,
  });
  return { service, stop };
}

describe("a driver stopping its sub-agent", () => {
  test("stops only its own sub-agent, which never comes back to it as a turn", async () => {
    const { service, stop } = makeService([
      invocationRow({ id: "own", driverAgentId: "driver-1" }),
      invocationRow({ id: "other", driverAgentId: "driver-2" }),
    ]);
    await expect(service.stopTarget("other", "driver-1")).rejects.toThrow(
      "not a sub-agent you started",
    );
    await service.stopTarget("own", "driver-1");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith(
      expect.objectContaining({ id: "own" }),
      expect.objectContaining({
        reason: "stopped by its driver",
        collectTarget: true,
      }),
    );
  });

  test("stops a kept sub-agent only with a reason, which the user reads", async () => {
    const { service, stop } = makeService([
      invocationRow({
        id: "kept",
        driverAgentId: "driver-1",
        keepUntil: new Date(Date.now() + 60_000),
      }),
    ]);
    await expect(service.stopTarget("kept", "driver-1")).rejects.toThrow(
      "takes a reason",
    );
    expect(stop).not.toHaveBeenCalled();
    await service.stopTarget("kept", "driver-1", "another one found it");
    expect(stop).toHaveBeenCalledWith(
      expect.objectContaining({ id: "kept" }),
      expect.objectContaining({
        reason: "stopped by its driver: another one found it",
      }),
    );
  });
});

describe("a stop's reason", () => {
  test("reads back as who stopped it, and a failure's as no stop", () => {
    expect(stoppedOf(driverStopReason("found it: elsewhere"))).toEqual({
      by: "driver",
      reason: "found it: elsewhere",
    });
    expect(stoppedOf(driverStopReason())).toEqual({
      by: "driver",
      reason: null,
    });
    expect(stoppedOf(userStopReason())).toEqual({ by: "user", reason: null });
    expect(stoppedOf("install failed: exit 1")).toBeNull();
  });
});
