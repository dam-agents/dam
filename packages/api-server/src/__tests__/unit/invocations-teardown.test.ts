import { describe, expect, test, vi } from "vitest";

import type { InvocationRow } from "../../modules/invocations/infrastructure/invocations-repository.js";
import { createDelegationControl } from "../../modules/invocations/services/delegation-control.js";
import { createDelegationStop } from "../../modules/invocations/services/delegation-stop.js";
import type { DelegationFramesPort } from "../../modules/invocations/services/delegation-frames.js";
import { createDriverCascade } from "../../modules/invocations/services/driver-cascade.js";
import { createTargetCapture } from "../../modules/invocations/services/target-capture.js";
import { createTargetReaper } from "../../modules/invocations/services/target-reaper.js";
import {
  fakeInvocationsRepo,
  invocationRow,
} from "../helpers/invocations-repo.js";

function row(
  id: string,
  overrides: Partial<InvocationRow> = {},
): InvocationRow {
  return invocationRow({
    id,
    driverAgentId: "root-1",
    rootDriverId: "root-1",
    resultSchema: {},
    ...overrides,
  });
}

function fakeRepo(rows: InvocationRow[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const calls = {
    markReaped: vi.fn(async (_id: string) => {}),
    markTranscriptCaptured: vi.fn(async (_id: string, _t: boolean) => {}),
    deleteReapedByRoot: vi.fn(async (_root: string) => 0),
    fail: vi.fn(async (_runId: string, _reason: string) => null),
    failStopped: vi.fn(
      async (runId: string, _reason: string, _collected: boolean) => {
        const run = rows.find((r) => r.runId === runId);
        if (!run || run.status !== "running") return null;
        run.status = "failed";
        return { cancelPending: false };
      },
    ),
  };
  const repo = fakeInvocationsRepo({
    get: async (id) => byId.get(id) ?? null,
    fail: calls.fail,
    failStopped: calls.failStopped,
    listRunningRuns: async (id) =>
      rows.filter((r) => r.id === id && r.status === "running"),
    listRunningRunsOf: async (ids) =>
      rows.filter((r) => ids.includes(r.id) && r.status === "running"),
    listRunningByDriver: async (driver) =>
      rows.filter((r) => r.driverAgentId === driver && r.status === "running"),
    markReaped: calls.markReaped,
    listUnreapedByDriver: async (driver) =>
      rows.filter((r) => r.driverAgentId === driver && r.reapedAt === null),
    listByRoot: async (root) => rows.filter((r) => r.rootDriverId === root),
    listUnreapedByRoot: async (root) =>
      rows.filter((r) => r.rootDriverId === root && r.reapedAt === null),
    listTreeOfRoot: async (root) => rows.filter((r) => r.rootDriverId === root),
    markTranscriptCaptured: calls.markTranscriptCaptured,
    deleteReapedByRoot: calls.deleteReapedByRoot,
  });
  return { repo, calls };
}

function fakeFrames(overrides: Partial<DelegationFramesPort> = {}) {
  const port: DelegationFramesPort = {
    readFromTarget: vi.fn(async () => ({
      frames: ["f1", "f2"],
      truncated: false,
    })),
    storeOnRoot: vi.fn(async () => ({ truncated: false })),
    readFromRoot: vi.fn(async () => null),
    ...overrides,
  };
  return port;
}

describe("the target reaper", () => {
  test("marks the row reaped after the delete", async () => {
    const { repo, calls } = fakeRepo([row("agent-a")]);
    const reaper = createTargetReaper({
      repo,
      agentsFor: () => ({ delete: async () => {} }) as never,
      cancel: { request: async () => {} },
      capture: { capture: async () => {} },
    });
    await reaper.reap({ id: "agent-a", owner: "owner-1" });
    expect(calls.markReaped).toHaveBeenCalledWith("agent-a");
  });

  test("leaves the row unreaped and never throws when the delete fails", async () => {
    const { repo, calls } = fakeRepo([row("agent-a")]);
    const reaper = createTargetReaper({
      repo,
      agentsFor: () =>
        ({
          delete: async () => {
            throw new Error("k8s down");
          },
        }) as never,
      cancel: { request: async () => {} },
      capture: { capture: async () => {} },
    });
    await expect(
      reaper.reap({ id: "agent-a", owner: "owner-1" }),
    ).resolves.toBeUndefined();
    expect(calls.markReaped).not.toHaveBeenCalled();
  });

  test("never throws when marking the row fails", async () => {
    const { repo, calls } = fakeRepo([row("agent-a")]);
    calls.markReaped.mockRejectedValueOnce(new Error("db gone"));
    const reaper = createTargetReaper({
      repo,
      agentsFor: () => ({ delete: async () => {} }) as never,
      cancel: { request: async () => {} },
      capture: { capture: async () => {} },
    });
    await expect(
      reaper.reap({ id: "agent-a", owner: "owner-1" }),
    ).resolves.toBeUndefined();
  });

  test("captures before deleting unless told not to", async () => {
    const order: string[] = [];
    const { repo } = fakeRepo([row("agent-a")]);
    const reaper = createTargetReaper({
      repo,
      agentsFor: () =>
        ({ delete: async () => void order.push("delete") }) as never,
      cancel: { request: async () => {} },
      capture: { capture: async () => void order.push("capture") },
    });
    await reaper.reap({ id: "agent-a", owner: "owner-1" });
    await reaper.reap(
      { id: "agent-a", owner: "owner-1" },
      { capture: false, force: true },
    );
    expect(order).toEqual(["capture", "delete", "delete"]);
  });
});

describe("the target capture", () => {
  test("stores the target's frames on its root and stamps the record", async () => {
    const { repo, calls } = fakeRepo([
      row("agent-a", { rootDriverId: "root-9" }),
    ]);
    const frames = fakeFrames({
      storeOnRoot: vi.fn(async () => ({ truncated: true })),
    });
    await createTargetCapture({ repo, frames }).capture({ id: "agent-a" });
    expect(frames.storeOnRoot).toHaveBeenCalledWith("root-9", "agent-a", [
      "f1",
      "f2",
    ]);
    expect(calls.markTranscriptCaptured).toHaveBeenCalledWith("agent-a", true);
  });

  test("leaves the record uncaptured when the root keeps nothing", async () => {
    const { repo, calls } = fakeRepo([row("agent-a")]);
    const frames = fakeFrames({ storeOnRoot: vi.fn(async () => null) });
    await createTargetCapture({ repo, frames }).capture({ id: "agent-a" });
    expect(calls.markTranscriptCaptured).not.toHaveBeenCalled();
  });

  test("stores nothing for a target with no conversation", async () => {
    const { repo } = fakeRepo([row("agent-a")]);
    const frames = fakeFrames({ readFromTarget: vi.fn(async () => null) });
    await createTargetCapture({ repo, frames }).capture({ id: "agent-a" });
    expect(frames.storeOnRoot).not.toHaveBeenCalled();
  });

  test("returns within its budget when the target never answers", async () => {
    vi.useFakeTimers();
    try {
      const { repo, calls } = fakeRepo([row("agent-a")]);
      const frames = fakeFrames({
        readFromTarget: vi.fn(() => new Promise<never>(() => {})),
      });
      const done = createTargetCapture({ repo, frames }).capture({
        id: "agent-a",
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(done).resolves.toBeUndefined();
      expect(calls.markTranscriptCaptured).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the driver cascade", () => {
  function reaperSpy() {
    return {
      reap: vi.fn(
        async (
          _row: { id: string; owner: string },
          _opts?: { capture?: boolean },
        ) => {},
      ),
    };
  }

  test("a deleted root reaps every target of its tree that may still exist, then drops the reaped records", async () => {
    const { repo, calls } = fakeRepo([
      row("agent-a"),
      row("agent-b", { driverAgentId: "agent-a" }),
      row("agent-c", { status: "done", completedAt: new Date() }),
      row("agent-d", { status: "done", reapedAt: new Date() }),
    ]);
    const reaper = reaperSpy();
    await createDriverCascade({
      repo,
      reaper,
      outputs: { purgeRoot: async () => {} },
    })("root-1");
    const reaped = reaper.reap.mock.calls.map(([r]) => r.id).sort();
    expect(reaped).toEqual(["agent-a", "agent-b", "agent-c"]);
    for (const call of reaper.reap.mock.calls) {
      expect(call).toContainEqual({ capture: false, force: true });
    }
    expect(calls.fail.mock.calls.map(([id]) => id).sort()).toEqual([
      "agent-a",
      "agent-b",
    ]);
    expect(calls.deleteReapedByRoot).toHaveBeenCalledWith("root-1");
  });

  // TEST_SCENARIO: a deleted sub-agent that drives its own takes every child it still has: a running one is failed, and a kept one that reported and a clean slate that never ran are reaped too, since nothing else would remove them.
  test("a deleted target captures its own children and keeps the root's records", async () => {
    const { repo, calls } = fakeRepo([
      row("agent-mid"),
      row("agent-leaf", { driverAgentId: "agent-mid" }),
      row("agent-kept", {
        driverAgentId: "agent-mid",
        status: "done",
        keepUntil: new Date(Date.now() + 60_000),
      }),
      row("agent-slate", { driverAgentId: "agent-mid", status: "idle" }),
    ]);
    const reaper = reaperSpy();
    await createDriverCascade({
      repo,
      reaper,
      outputs: { purgeRoot: async () => {} },
    })("agent-mid");
    expect(calls.fail).toHaveBeenCalledWith(
      "agent-mid",
      "target agent deleted",
    );
    expect(calls.markReaped).toHaveBeenCalledWith("agent-mid");
    expect(calls.fail).not.toHaveBeenCalledWith(
      "agent-kept",
      expect.anything(),
    );
    expect(reaper.reap.mock.calls.map(([r, opts]) => [r.id, opts])).toEqual([
      ["agent-leaf", { capture: true, force: true }],
      ["agent-kept", { capture: true, force: true }],
      ["agent-slate", { capture: true, force: true }],
    ]);
    expect(calls.deleteReapedByRoot).not.toHaveBeenCalled();
  });
});

describe("stopping a delegation", () => {
  const control = (rows: InvocationRow[]) => {
    const { repo, calls } = fakeRepo(rows);
    const reaper = { reap: vi.fn(async (_row: { id: string }) => {}) };
    const stopper = createDelegationStop({ repo, reaper });
    return {
      calls,
      reaper,
      control: createDelegationControl({ repo, owner: "owner-1", stopper }),
    };
  };

  test("the user's stop takes every running sub-agent below the target down, kept ones too, and only the target reaches its driver", async () => {
    const {
      control: c,
      calls,
      reaper,
    } = control([
      row("agent-a", { runId: "run-a" }),
      row("agent-b", { driverAgentId: "agent-a", runId: "run-b" }),
      row("agent-c", {
        driverAgentId: "agent-b",
        runId: "run-c",
        keepUntil: new Date(Date.now() + 60_000),
      }),
      row("agent-d", { driverAgentId: "agent-a", status: "done" }),
    ]);
    await c.stop({ driverAgentId: "root-1", id: "agent-a" });
    expect(calls.failStopped.mock.calls).toEqual([
      ["run-a", "stopped by the user", false],
      ["run-b", "stopped by the user", true],
      ["run-c", "stopped by the user", true],
    ]);
    expect(reaper.reap.mock.calls.map(([r]) => r.id)).toEqual([
      "agent-a",
      "agent-b",
      "agent-c",
    ]);
  });

  test("does not find a child that is another owner's or under another root", async () => {
    const {
      control: c,
      calls,
      reaper,
    } = control([
      row("agent-a", { owner: "owner-2" }),
      row("agent-b", { rootDriverId: "root-9" }),
    ]);
    await expect(
      c.stop({ driverAgentId: "root-1", id: "agent-a" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      c.stop({ driverAgentId: "root-1", id: "agent-b" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls.failStopped).not.toHaveBeenCalled();
    expect(reaper.reap).not.toHaveBeenCalled();
  });
});
