import { describe, expect, test } from "vitest";

import type {
  InvocationRow,
  InvocationStart,
  InvocationsRepository,
} from "../../modules/invocations/infrastructure/invocations-repository.js";
import { createInvocationLivenessSweep } from "../../modules/invocations/services/invocation-liveness.js";
import { createInvocationStart } from "../../modules/invocations/services/invocation-start.js";
import { invocationRow } from "../helpers/invocations-repo.js";

/**
 * TEST_OVERVIEW: a sub-agent's deadline runs from its start, the first
 * delivery of its task, not from its spawn. The delivery resolver gives a
 * script's task stop and report times from that start, and the liveness
 * sweep fails a sub-agent that never started with a reason that names the
 * wait.
 */
const START = new Date("2026-11-04T10:00:00Z");
const DEADLINE = new Date("2026-11-04T11:00:00Z");

function resolverWith(markStarted: () => Promise<InvocationStart | null>) {
  return createInvocationStart({ repo: { markStarted }, log: () => {} });
}

const scriptTask = {
  id: "invocation-agent-1:1",
  kind: "invocation-script",
  payload: {
    command: "make test",
    deadline: "2026-11-04T09:15:00.000Z",
    reportBy: "2026-11-04T09:30:00.000Z",
  },
};

describe("invocation start: the deadline runs from the first delivery", () => {
  // TEST_SCENARIO: a script's task was queued at the spawn with times from the spawn; delivered after a wait for room, it must carry times from its start, or the runtime stops the script before the deadline the sweep holds it to.
  test("a delivered script task stops and reports by times set from its start", async () => {
    const resolve = resolverWith(async () => ({
      startedAt: START,
      expiresAt: DEADLINE,
      keepUntil: null,
    }));

    const event = await resolve("agent-1", scriptTask);

    expect(event?.payload).toEqual({
      command: "make test",
      deadline: "2026-11-04T10:55:00.000Z",
      reportBy: DEADLINE.toISOString(),
    });
  });
});

function unstartedExpiredRow(): InvocationRow {
  return invocationRow({
    ttlMs: 30 * 60_000,
    createdAt: new Date("2026-11-04T09:00:00Z"),
    expiresAt: new Date("2026-11-04T09:30:00Z"),
  });
}

async function failReasonOf(row: InvocationRow, wait: string | null) {
  const failed: string[] = [];
  const repo = {
    listExpiredRunning: async () => [row],
    listExpiredIdle: async () => [],
    listUnreapedByDriver: async () => [],
    listCancelPending: async () => [],
    clearCancel: async () => {},
    listRunning: async () => [],
    listTerminalUnreaped: async () => [],
    failExpired: async (_runId: string, reason: string) => {
      failed.push(reason);
      return { cancelPending: false };
    },
  } as unknown as InvocationsRepository;
  const sweep = createInvocationLivenessSweep({
    repo,
    reaper: { reap: async () => {} },
    reportedReap: { due: async () => true },
    cancel: { settled: async () => true },
    readTargetRestart: async () => null,
    readStartWait: async () => wait,
    hasAgent: async () => true,
    readHarnessConfigSupport: async () => null,
    runsScripts: async () => true,
    outputs: { purgeExpired: async () => 0, purgeRoot: async () => {} },
    batchSize: 10,
  });
  await sweep.tick();
  return failed;
}

describe("invocation start: a sub-agent that never started", () => {
  test("fails naming how long it waited and why", async () => {
    const wait = "Your VM agents' memory is full.";

    expect(await failReasonOf(unstartedExpiredRow(), wait)).toEqual([
      `the sub-agent did not start within 30 min of its spawn. ${wait}`,
    ]);
  });
});
