import { describe, expect, test } from "vitest";

import type {
  ExperimentRow,
  ExperimentsRepository,
} from "../../modules/experiments/infrastructure/experiments-repository.js";
import { createExperimentsService } from "../../modules/experiments/services/experiments-service.js";

/**
 * Every terminal transition must shed the run's still-running Invocations, not
 * just Stop. The ledger is closed once an experiment goes terminal, so a target
 * left alive can no longer report into the run — it only holds its pod (and its
 * owner's budget) until the invocation TTL. The Agent Sweep is not a backstop
 * here: it reclaims a Sweepable target only once the target hibernates, and a
 * template can disable hibernation outright (the nous catalogue entry sets
 * `hibernationTimeout: "0s"` so a detached campaign is not killed mid-run).
 *
 * `finish("completed")` counts: a loop that returns without awaiting a spawn
 * orphans its target exactly like one that died mid-poll.
 */
const OWNER = "owner-1";
const DRIVER = "driver-1";
const EXPERIMENT = "exp-1";

function runningRow(): ExperimentRow {
  return {
    id: EXPERIMENT,
    owner: OWNER,
    driverAgentId: DRIVER,
    name: "tiny-cache",
    status: "running",
    skeleton: { stages: [] } as unknown as ExperimentRow["skeleton"],
    drift: [],
    customData: null,
    attachedArtifactIds: [],
    scriptPath: "run.py",
    scriptSha256: "sha",
    scriptArtifactId: "art-1",
    scriptVersion: 1,
    dashboardArtifactId: null,
    error: null,
    createdAt: new Date(),
    executedAt: new Date(),
    finishedAt: null,
    lastActivityAt: new Date(),
  };
}

function makeService() {
  const cancelled: {
    driverAgentId: string;
    experimentId: string;
    reason: string;
  }[] = [];
  const row = runningRow();
  const repo = {
    get: async () => row,
    transition: async () => true,
    hasRunningForDriver: async () => false,
  } as unknown as ExperimentsRepository;

  const experiments = createExperimentsService({
    owner: OWNER,
    repo,
    cancelInvocations: async (
      driverAgentId: string,
      experimentId: string,
      reason: string,
    ) => {
      cancelled.push({ driverAgentId, experimentId, reason });
    },
  } as unknown as Parameters<typeof createExperimentsService>[0]);

  return { experiments, cancelled };
}

describe("experiment terminal transitions reap in-flight targets", () => {
  test("finish(completed) fails the run's running invocations", async () => {
    const { experiments, cancelled } = makeService();

    await experiments.finish(DRIVER, EXPERIMENT, { status: "completed" });

    expect(cancelled).toEqual([
      {
        driverAgentId: DRIVER,
        experimentId: EXPERIMENT,
        reason: "experiment completed",
      },
    ]);
  });

  test("finish(failed) reaps too — a script that died mid-poll orphans its target", async () => {
    const { experiments, cancelled } = makeService();

    await experiments.finish(DRIVER, EXPERIMENT, {
      status: "failed",
      error: "RuntimeError: GET /invocations/... -> 503",
    });

    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.reason).toBe("experiment failed");
  });

  test("a failing cancel does not block the terminal transition", async () => {
    const row = runningRow();
    const repo = {
      get: async () => row,
      transition: async () => true,
      hasRunningForDriver: async () => false,
    } as unknown as ExperimentsRepository;
    const experiments = createExperimentsService({
      owner: OWNER,
      repo,
      cancelInvocations: async () => {
        throw new Error("boom");
      },
    } as unknown as Parameters<typeof createExperimentsService>[0]);

    // Best-effort, like the rest of the terminal bookkeeping: the run must
    // still land terminal even if reaping its targets fails.
    await expect(
      experiments.finish(DRIVER, EXPERIMENT, { status: "completed" }),
    ).resolves.toBeUndefined();
  });

  test("stop still passes its own reason", async () => {
    const { experiments, cancelled } = makeService();

    await experiments.stop(EXPERIMENT);

    expect(cancelled[0]?.reason).toBe("experiment stopped");
  });
});
