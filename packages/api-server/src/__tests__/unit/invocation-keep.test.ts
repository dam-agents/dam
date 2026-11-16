// TEST_OVERVIEW: a target spawned with keep outlives its result asleep, until its keep expiry: every reap leaves it alone until then, except the one that deletes its driver, and asks it to end a run that failed while its work may still run; a run left unended stops the machine only once nothing else runs there; the expiry is a day by default and never longer than an Environment may live.
import { describe, expect, it } from "vitest";
import {
  keepUntil,
  DEFAULT_KEEP_MS,
} from "../../modules/invocations/domain/keep.js";
import { createTargetReaper } from "../../modules/invocations/services/target-reaper.js";
import { createRunCancel } from "../../modules/invocations/services/run-cancel.js";
import {
  fakeInvocationsRepo,
  invocationRow,
} from "../helpers/invocations-repo.js";

const NOW = new Date("2026-11-08T10:00:00Z");

function reaperWith(
  keep: Date | null,
  opts: { cancelPending?: boolean; running?: boolean } = {},
) {
  const deleted: string[] = [];
  const cancelled: string[] = [];
  const reaper = createTargetReaper({
    repo: fakeInvocationsRepo({
      get: async (id) => invocationRow({ id, keepUntil: keep }),
      getRun: async (runId) =>
        invocationRow({
          runId,
          keepUntil: keep,
          status: "failed",
          cancelPending: opts.cancelPending ?? false,
        }),
      hasRunning: async () => opts.running ?? false,
    }),
    agentsFor: () =>
      ({
        delete: async (id: string) => {
          deleted.push(id);
        },
      }) as never,
    cancel: {
      request: async (run) => {
        cancelled.push(run.runId!);
      },
    },
    capture: { capture: async () => {} } as never,
    now: () => NOW,
  });
  return { reaper, deleted, cancelled };
}

function cancelWith(opts: {
  state: string;
  running: boolean;
  endedAgoMs: number;
}) {
  const slept: string[] = [];
  const cleared: string[] = [];
  const cancel = createRunCancel({
    repo: {
      hasRunning: async () => opts.running,
      clearCancel: async (runId) => {
        cleared.push(runId);
      },
    },
    agentsFor: () => ({
      get: async () => ({ state: opts.state, stopRequested: false }) as never,
      sleep: async (id: string) => {
        slept.push(id);
        return null;
      },
    }),
    runtimeMutator: {} as never,
    now: () => NOW,
  });
  const run = {
    id: "agent-kept",
    owner: "u",
    runId: "run-1",
    completedAt: new Date(NOW.getTime() - opts.endedAgoMs),
  };
  return { cancel, run, slept, cleared };
}

describe("a kept target", () => {
  // TEST_SCENARIO: before its keep expiry a kept target survives an ordinary reap (after its report, by the liveness sweep, after its script) and is deleted only when the reap is forced because its driver goes; after its expiry an ordinary reap deletes it, unless a run of it still runs.
  it("is reaped only when forced or once its keep has passed and nothing runs", async () => {
    const kept = reaperWith(new Date(NOW.getTime() + 60_000));
    await kept.reaper.reap({ id: "agent-kept", owner: "u" });
    expect(kept.deleted).toEqual([]);
    await kept.reaper.reap({ id: "agent-kept", owner: "u" }, { force: true });
    expect(kept.deleted).toEqual(["agent-kept"]);

    const expired = reaperWith(new Date(NOW.getTime() - 1));
    await expired.reaper.reap({ id: "agent-old", owner: "u" });
    expect(expired.deleted).toEqual(["agent-old"]);

    const busy = reaperWith(new Date(NOW.getTime() - 1), { running: true });
    await busy.reaper.reap({ id: "agent-busy", owner: "u" });
    expect(busy.deleted).toEqual([]);
  });

  // TEST_SCENARIO: a run of a kept target that was stopped, timed out or failed to set up may still be running its turn or script, so the reap asks the target to end that run and keeps it; a run that reported has nothing left running.
  it("is asked to end a run that failed while its work may still run", async () => {
    const failed = reaperWith(new Date(NOW.getTime() + 60_000), {
      cancelPending: true,
    });
    await failed.reaper.reap({ id: "agent-failed", owner: "u", runId: "r1" });
    expect(failed.cancelled).toEqual(["r1"]);
    expect(failed.deleted).toEqual([]);

    const reported = reaperWith(new Date(NOW.getTime() + 60_000));
    await reported.reaper.reap({
      id: "agent-reported",
      owner: "u",
      runId: "r2",
    });
    expect(reported.cancelled).toEqual([]);
  });

  // TEST_SCENARIO: a run the target never confirmed ending stops its machine as a last resort, but only after a while and only when no other run of the target is running there; a stopped machine runs nothing, which settles the run.
  it("stops its machine for an unended run only when nothing else runs", async () => {
    const early = cancelWith({
      state: "ready",
      running: false,
      endedAgoMs: 10_000,
    });
    expect(await early.cancel.settled(early.run)).toBe(false);
    expect(early.slept).toEqual([]);

    const busy = cancelWith({
      state: "ready",
      running: true,
      endedAgoMs: 600_000,
    });
    expect(await busy.cancel.settled(busy.run)).toBe(false);
    expect(busy.slept).toEqual([]);

    const idle = cancelWith({
      state: "ready",
      running: false,
      endedAgoMs: 600_000,
    });
    expect(await idle.cancel.settled(idle.run)).toBe(false);
    expect(idle.slept).toEqual(["agent-kept"]);

    const asleep = cancelWith({
      state: "hibernated",
      running: true,
      endedAgoMs: 0,
    });
    expect(await asleep.cancel.settled(asleep.run)).toBe(true);
    expect(asleep.cleared).toEqual(["run-1"]);
  });

  // TEST_SCENARIO: a keep without a time lasts a day; one longer than an Environment may live, or shorter than a minute, is refused with a reason the driver can act on.
  it("is kept a day by default, within the Environment limit", () => {
    const max = 7 * 86_400_000;
    expect(keepUntil(NOW, undefined, max)).toEqual(
      new Date(NOW.getTime() + DEFAULT_KEEP_MS),
    );
    expect(keepUntil(NOW, 8 * 86_400_000, max)).toEqual({
      error:
        "keepFor may be at most 7 days, as long as an Environment may live",
    });
    expect(keepUntil(NOW, 1000, max)).toHaveProperty("error");
  });
});
