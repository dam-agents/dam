import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Experiment, ExperimentArm, ExperimentRun } from "api-server-api";
import { createExperimentsService } from "../../modules/experiments/services/experiments-service.js";
import type { ExperimentsRepository } from "../../modules/experiments/infrastructure/experiments-repository.js";
import type { TrialLauncher } from "../../modules/experiments/infrastructure/trial-launcher.js";

const OWNER = "owner-1";

function makeExperiment(over: Partial<Experiment> = {}): Experiment {
  return {
    id: "exp-1",
    ownerId: OWNER,
    name: "exp",
    prompt: "do the thing",
    status: "draft",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function makeArm(over: Partial<ExperimentArm> = {}): ExperimentArm {
  return {
    experimentId: "exp-1",
    agentId: "agent-1",
    armSpec: {},
    status: "running",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function makeRun(over: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    id: "run-1",
    experimentId: "exp-1",
    agentId: "agent-1",
    runNumber: 1,
    sessionId: "sess-1",
    candidateRef: "exp-1/agent-1/x/candidate.json",
    score: 0.5,
    status: "completed",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    ...over,
  };
}

/** Build a repo of vi.fn() stubs; override only what a test exercises. */
function fakeRepo(
  over: Partial<ExperimentsRepository> = {},
): ExperimentsRepository {
  return {
    create: vi.fn(),
    listByOwner: vi.fn(),
    get: vi.fn(),
    updateStatus: vi.fn(),
    stop: vi.fn(),
    delete: vi.fn(),
    addArm: vi.fn(),
    listArms: vi.fn(async () => []),
    listRuns: vi.fn(async () => []),
    markArmsRunning: vi.fn(async () => {}),
    failLaunch: vi.fn(async () => {}),
    addRun: vi.fn(),
    finishArm: vi.fn(),
    findActiveArm: vi.fn(),
    listInactiveRunningArms: vi.fn(),
    failInactiveArm: vi.fn(),
    ...over,
  } as unknown as ExperimentsRepository;
}

describe("start", () => {
  it("flips to running, marks arms running, and launches each running arm", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(makeExperiment({ status: "draft" }))
      .mockResolvedValue(makeExperiment({ status: "running" }));
    const repo = fakeRepo({
      get,
      updateStatus: vi.fn(async () => makeExperiment({ status: "running" })),
      listArms: vi.fn(async () => [
        makeArm({ agentId: "a" }),
        makeArm({ agentId: "b" }),
      ]),
    });
    const launcher: TrialLauncher = { launch: vi.fn(async () => {}) };
    const service = createExperimentsService({
      owner: OWNER,
      repo,
      trialLauncher: launcher,
    });

    const result = await service.start("exp-1");

    expect(repo.markArmsRunning).toHaveBeenCalledWith("exp-1");
    expect(launcher.launch).toHaveBeenCalledTimes(2);
    expect(repo.failLaunch).not.toHaveBeenCalled();
    expect(result.status).toBe("running");
  });

  it("fails the arm immediately when its trial launch throws", async () => {
    const repo = fakeRepo({
      get: vi
        .fn()
        .mockResolvedValueOnce(makeExperiment({ status: "draft" }))
        .mockResolvedValue(makeExperiment({ status: "running" })),
      updateStatus: vi.fn(async () => makeExperiment({ status: "running" })),
      listArms: vi.fn(async () => [
        makeArm({ agentId: "a" }),
        makeArm({ agentId: "b" }),
      ]),
    });
    const launcher: TrialLauncher = {
      launch: vi.fn(async ({ agentId }) => {
        if (agentId === "b") throw new Error("wake failed");
      }),
    };
    const service = createExperimentsService({
      owner: OWNER,
      repo,
      trialLauncher: launcher,
    });

    await service.start("exp-1");

    expect(repo.failLaunch).toHaveBeenCalledTimes(1);
    expect(repo.failLaunch).toHaveBeenCalledWith("exp-1", "b");
  });

  it("does not launch arms that are not running", async () => {
    const repo = fakeRepo({
      get: vi
        .fn()
        .mockResolvedValueOnce(makeExperiment({ status: "draft" }))
        .mockResolvedValue(makeExperiment({ status: "running" })),
      updateStatus: vi.fn(async () => makeExperiment({ status: "running" })),
      listArms: vi.fn(async () => [
        makeArm({ agentId: "a", status: "running" }),
        makeArm({ agentId: "c", status: "failed" }),
      ]),
    });
    const launcher: TrialLauncher = { launch: vi.fn(async () => {}) };
    const service = createExperimentsService({
      owner: OWNER,
      repo,
      trialLauncher: launcher,
    });

    await service.start("exp-1");

    expect(launcher.launch).toHaveBeenCalledTimes(1);
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "a" }),
    );
  });

  it("rejects starting a completed experiment", async () => {
    const repo = fakeRepo({
      get: vi.fn(async () => makeExperiment({ status: "completed" })),
    });
    const service = createExperimentsService({ owner: OWNER, repo });

    await expect(service.start("exp-1")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(repo.markArmsRunning).not.toHaveBeenCalled();
  });
});

describe("stop", () => {
  it("delegates to the atomic repo.stop cascade when running", async () => {
    const repo = fakeRepo({
      get: vi.fn(async () => makeExperiment({ status: "running" })),
      stop: vi.fn(async () => makeExperiment({ status: "stopped" })),
    });
    const service = createExperimentsService({ owner: OWNER, repo });

    const result = await service.stop("exp-1");

    expect(repo.stop).toHaveBeenCalledWith("exp-1", OWNER);
    expect(result.status).toBe("stopped");
  });

  it("rejects stopping a non-running experiment", async () => {
    const repo = fakeRepo({
      get: vi.fn(async () => makeExperiment({ status: "completed" })),
    });
    const service = createExperimentsService({ owner: OWNER, repo });

    await expect(service.stop("exp-1")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(repo.stop).not.toHaveBeenCalled();
  });
});

describe("recordRun ledger guard", () => {
  it("returns the run when the arm is still running", async () => {
    const repo = fakeRepo({ addRun: vi.fn(async () => makeRun()) });
    const service = createExperimentsService({ owner: OWNER, repo });

    const run = await service.recordRun({
      experimentId: "exp-1",
      agentId: "agent-1",
      sessionId: "sess-1",
      candidateRef: "k",
      score: 0.5,
    });
    expect(run.runNumber).toBe(1);
  });

  it("rejects with CONFLICT when the arm is no longer running", async () => {
    const repo = fakeRepo({ addRun: vi.fn(async () => null) });
    const service = createExperimentsService({ owner: OWNER, repo });

    await expect(
      service.recordRun({
        experimentId: "exp-1",
        agentId: "agent-1",
        sessionId: "sess-1",
        candidateRef: "k",
        score: 0.5,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("finishArm", () => {
  it("returns the completed arm", async () => {
    const repo = fakeRepo({
      finishArm: vi.fn(async () => makeArm({ status: "completed" })),
    });
    const service = createExperimentsService({ owner: OWNER, repo });

    const arm = await service.finishArm({
      experimentId: "exp-1",
      agentId: "agent-1",
    });
    expect(arm.status).toBe("completed");
    expect(repo.finishArm).toHaveBeenCalledWith("exp-1", "agent-1");
  });

  it("rejects with CONFLICT when the arm is not running", async () => {
    const repo = fakeRepo({ finishArm: vi.fn(async () => null) });
    const service = createExperimentsService({ owner: OWNER, repo });

    await expect(
      service.finishArm({ experimentId: "exp-1", agentId: "agent-1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
