import { describe, expect, test, vi } from "vitest";

import type {
  InvocationRow,
  InvocationsRepository,
} from "../../modules/invocations/infrastructure/invocations-repository.js";
import { createDelegationControl } from "../../modules/invocations/services/delegation-control.js";
import type { DelegationFramesPort } from "../../modules/invocations/services/delegation-frames.js";
import { createDriverCascade } from "../../modules/invocations/services/driver-cascade.js";
import { createTargetCapture } from "../../modules/invocations/services/target-capture.js";
import { createTargetReaper } from "../../modules/invocations/services/target-reaper.js";

function row(
  id: string,
  overrides: Partial<InvocationRow> = {},
): InvocationRow {
  return {
    id,
    driverAgentId: "root-1",
    rootDriverId: "root-1",
    owner: "owner-1",
    label: null,
    prompt: "",
    templateId: null,
    image: null,
    connections: [],
    cpu: null,
    memory: null,
    ttlMs: null,
    resultSchema: {},
    result: null,
    status: "running",
    errorReason: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    completedAt: null,
    reapedAt: null,
    transcriptCaptured: false,
    transcriptTruncated: false,
    ...overrides,
  };
}

function fakeRepo(rows: InvocationRow[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const calls = {
    markReaped: vi.fn(async (_id: string) => {}),
    markTranscriptCaptured: vi.fn(async (_id: string, _t: boolean) => {}),
    deleteByRoot: vi.fn(async (_root: string) => 0),
    fail: vi.fn(async (_id: string, _reason: string) => {}),
  };
  const repo: InvocationsRepository = {
    insert: async () => {},
    get: async (id) => byId.get(id) ?? null,
    complete: async () => true,
    fail: calls.fail,
    listExpiredRunning: async () => [],
    listRunning: async () => [],
    listRunningByDriver: async (driver) =>
      rows.filter((r) => r.driverAgentId === driver && r.status === "running"),
    listRunningAgentIds: async () => [],
    listTargetsByOwner: async () => [],
    listRootDriverIds: async () => [],
    listTerminalUnreaped: async () => [],
    markReaped: calls.markReaped,
    listByRoot: async (root) => rows.filter((r) => r.rootDriverId === root),
    delete: async () => {},
    markTranscriptCaptured: calls.markTranscriptCaptured,
    deleteByRoot: calls.deleteByRoot,
  };
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
      capture: { capture: async () => void order.push("capture") },
    });
    await reaper.reap({ id: "agent-a", owner: "owner-1" });
    await reaper.reap({ id: "agent-a", owner: "owner-1" }, { capture: false });
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

  test("a deleted root reaps every target of its tree that may still exist, then drops its records", async () => {
    const { repo, calls } = fakeRepo([
      row("agent-a"),
      row("agent-b", { driverAgentId: "agent-a" }),
      row("agent-c", { status: "done", completedAt: new Date() }),
      row("agent-d", { status: "done", reapedAt: new Date() }),
    ]);
    const reaper = reaperSpy();
    await createDriverCascade({ repo, reaper })("root-1");
    const reaped = reaper.reap.mock.calls.map(([r]) => r.id).sort();
    expect(reaped).toEqual(["agent-a", "agent-b", "agent-c"]);
    for (const call of reaper.reap.mock.calls) {
      expect(call).toContainEqual({ capture: false });
    }
    expect(calls.fail.mock.calls.map(([id]) => id).sort()).toEqual([
      "agent-a",
      "agent-b",
    ]);
    expect(calls.deleteByRoot).toHaveBeenCalledWith("root-1");
  });

  test("a deleted target captures its own children and keeps the root's records", async () => {
    const { repo, calls } = fakeRepo([
      row("agent-mid"),
      row("agent-leaf", { driverAgentId: "agent-mid" }),
    ]);
    const reaper = reaperSpy();
    await createDriverCascade({ repo, reaper })("agent-mid");
    expect(calls.fail).toHaveBeenCalledWith(
      "agent-mid",
      "target agent deleted",
    );
    expect(calls.markReaped).toHaveBeenCalledWith("agent-mid");
    expect(reaper.reap).toHaveBeenCalledTimes(1);
    expect(reaper.reap.mock.calls[0]).toContainEqual({ capture: true });
    expect(calls.deleteByRoot).not.toHaveBeenCalled();
  });
});

describe("stopping a delegation", () => {
  test("fails a running child of the owner's driver and reaps it", async () => {
    const { repo, calls } = fakeRepo([row("agent-a")]);
    const reaper = { reap: vi.fn(async () => {}) };
    await createDelegationControl({ repo, owner: "owner-1", reaper }).stop({
      driverAgentId: "root-1",
      id: "agent-a",
    });
    expect(calls.fail).toHaveBeenCalledWith("agent-a", "stopped by the user");
    expect(reaper.reap).toHaveBeenCalledTimes(1);
  });

  test("does not find a child that is another owner's or under another root", async () => {
    const { repo, calls } = fakeRepo([
      row("agent-a", { owner: "owner-2" }),
      row("agent-b", { rootDriverId: "root-9" }),
    ]);
    const reaper = { reap: vi.fn(async () => {}) };
    const control = createDelegationControl({ repo, owner: "owner-1", reaper });
    await expect(
      control.stop({ driverAgentId: "root-1", id: "agent-a" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      control.stop({ driverAgentId: "root-1", id: "agent-b" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls.fail).not.toHaveBeenCalled();
    expect(reaper.reap).not.toHaveBeenCalled();
  });
});
