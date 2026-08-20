import { describe, expect, test } from "vitest";

import type {
  InvocationRow,
  InvocationsRepository,
} from "../../modules/invocations/infrastructure/invocations-repository.js";
import {
  createInvocationLivenessSweep,
  type TargetRestartState,
} from "../../modules/invocations/services/invocation-liveness.js";

/**
 * TEST_OVERVIEW: Crash fast-fail (step 1b) reads the target's restart count off the Agent CR
 * the controller publishes — never off pods, which the api-server does not read
 * (docs/architecture/platform-topology.md). These cover the decision the sweep
 * makes from that signal; the controller side (turning a restarted container
 * into `status.agentPodRestarts`) is covered in the controller's own tests.
 */
function runningRow(id: string): InvocationRow {
  return {
    id,
    driverAgentId: "driver-1",
    owner: "owner-1",
    resultSchema: null,
    result: null,
    status: "running",
    errorReason: null,
    expiresAt: new Date(Date.now() + 60 * 60_000),
    completedAt: null,
    experimentSpanId: null,
  };
}

function makeSweep(
  rows: InvocationRow[],
  readTargetRestart: (agentId: string) => Promise<TargetRestartState | null>,
) {
  const failed: { id: string; reason: string }[] = [];
  const deleted: string[] = [];
  const repo = {
    listExpiredRunning: async () => [],
    listRunning: async () => rows,
    listAgedTerminal: async () => [],
    fail: async (id: string, reason: string) => {
      failed.push({ id, reason });
    },
    delete: async () => {},
  } as unknown as InvocationsRepository;

  const sweep = createInvocationLivenessSweep({
    repo,
    agentsFor: () =>
      ({
        delete: async (id: string) => {
          deleted.push(id);
        },
      }) as never,
    readTargetRestart,
    batchSize: 10,
  });
  return { sweep, failed, deleted };
}

describe("invocation liveness — crash fast-fail", () => {
  // TEST_SCENARIO: A target whose container restarted mid-turn cannot resume
  test("fails and reaps a target whose pod restarted, naming the cause", async () => {
    const { sweep, failed, deleted } = makeSweep(
      [runningRow("agent-crashed")],
      async () => ({ podRestarts: 1, podRestartReason: "OutOfMemory" }),
    );

    await sweep.tick();

    expect(failed).toHaveLength(1);
    expect(failed[0]!.id).toBe("agent-crashed");
    expect(failed[0]!.reason).toContain("OutOfMemory");
    expect(failed[0]!.reason).toContain("cannot resume");
    expect(deleted).toEqual(["agent-crashed"]);
  });

  // TEST_SCENARIO: The restart count alone ends the turn. When the controller
  test("still fails a restart the controller could not classify", async () => {
    const { sweep, failed } = makeSweep(
      [runningRow("agent-crashed")],
      async () => ({ podRestarts: 2 }),
    );

    await sweep.tick();

    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).not.toContain("(");
  });

  test("leaves a healthy target running", async () => {
    const { sweep, failed, deleted } = makeSweep(
      [runningRow("agent-healthy")],
      async () => ({ podRestarts: 0 }),
    );

    await sweep.tick();

    expect(failed).toEqual([]);
    expect(deleted).toEqual([]);
  });

  // TEST_SCENARIO: A missing Agent is not evidence of a crash — it is also how
  test("leaves a target whose Agent is absent alone", async () => {
    const { sweep, failed } = makeSweep(
      [runningRow("agent-gone")],
      async () => null,
    );

    await sweep.tick();

    expect(failed).toEqual([]);
  });

  // TEST_SCENARIO: One unreadable Agent must not take down the sweep. The rows
  test("a failing read does not fail the row or abort the tick", async () => {
    const seen: string[] = [];
    const { sweep, failed } = makeSweep(
      [runningRow("agent-unreadable"), runningRow("agent-crashed")],
      async (id) => {
        seen.push(id);
        if (id === "agent-unreadable") throw new Error("boom");
        return { podRestarts: 1, podRestartReason: "OutOfMemory" };
      },
    );

    await sweep.tick();

    expect(seen).toEqual(["agent-unreadable", "agent-crashed"]);
    expect(failed.map((f) => f.id)).toEqual(["agent-crashed"]);
  });
});
