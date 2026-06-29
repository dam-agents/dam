import { describe, it, expect, vi } from "vitest";
import {
  createExperimentArmSweeper,
  type ExperimentArmReaper,
} from "../../modules/experiments/services/experiment-arm-sweeper.js";

const NOW = new Date("2026-06-29T12:00:00.000Z");

describe("experiment-arm-sweeper", () => {
  it("reaps each listed candidate using a deadline of now minus the window", async () => {
    const failed: Array<{ id: string; agentId: string; deadline: Date }> = [];
    const repo: ExperimentArmReaper = {
      listInactiveRunningArms: vi.fn(async () => [
        { experimentId: "exp-1", agentId: "a" },
        { experimentId: "exp-1", agentId: "b" },
      ]),
      failInactiveArm: vi.fn(async (id, agentId, deadline) => {
        failed.push({ id, agentId, deadline });
        return true;
      }),
    };
    const sweeper = createExperimentArmSweeper({
      repo,
      inactivityMs: 60_000,
      intervalMs: 60_000,
      batchSize: 100,
      now: () => NOW,
    });

    await sweeper.tick();

    const expectedDeadline = new Date(NOW.getTime() - 60_000);
    expect(repo.listInactiveRunningArms).toHaveBeenCalledWith(
      expectedDeadline,
      100,
    );
    expect(failed).toEqual([
      { id: "exp-1", agentId: "a", deadline: expectedDeadline },
      { id: "exp-1", agentId: "b", deadline: expectedDeadline },
    ]);
  });

  it("is a no-op when nothing is inactive", async () => {
    const repo: ExperimentArmReaper = {
      listInactiveRunningArms: vi.fn(async () => []),
      failInactiveArm: vi.fn(async () => true),
    };
    const sweeper = createExperimentArmSweeper({
      repo,
      inactivityMs: 60_000,
      intervalMs: 60_000,
      batchSize: 100,
      now: () => NOW,
    });

    await sweeper.tick();
    expect(repo.failInactiveArm).not.toHaveBeenCalled();
  });

  it("continues past a candidate whose reap throws", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const reaped: string[] = [];
    const repo: ExperimentArmReaper = {
      listInactiveRunningArms: vi.fn(async () => [
        { experimentId: "exp-1", agentId: "boom" },
        { experimentId: "exp-1", agentId: "ok" },
      ]),
      failInactiveArm: vi.fn(async (_id, agentId) => {
        if (agentId === "boom") throw new Error("lock timeout");
        reaped.push(agentId);
        return true;
      }),
    };
    const sweeper = createExperimentArmSweeper({
      repo,
      inactivityMs: 60_000,
      intervalMs: 60_000,
      batchSize: 100,
      now: () => NOW,
    });

    await sweeper.tick();
    expect(reaped).toEqual(["ok"]);
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });
});
