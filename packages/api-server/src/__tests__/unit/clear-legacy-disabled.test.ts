// TEST_OVERVIEW: the boot step that removes the disabled mark a deleted feature left behind. An Agent still marked has its enabled recurring schedules paused before the mark goes, so nothing that was held while it was disabled starts on its own; a one-time task or an already paused one is left alone, and a failure at either write leaves the Agent marked for the next boot.
import { describe, expect, it } from "vitest";
import type { SchedulesBoot } from "../../modules/schedules/compose.js";
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import {
  clearLegacyDisabledMarks,
  pauseEnabledRecurringSchedules,
} from "../../modules/agents/sagas/clear-legacy-disabled.js";

type Agent = { id: string; owner?: string; disabled: boolean };

type Schedule = { id: string; spec: { type: string; enabled: boolean } };

type Recorder = {
  failing?: string[];
  order?: string[];
};

function fakeRepo(agents: Agent[], opts: Recorder = {}) {
  const cleared: string[] = [];
  return {
    cleared,
    async list() {
      return agents as unknown as InfraAgent[];
    },
    async clearLegacyDisabled(id: string) {
      if (opts.failing?.includes(id)) throw new Error("store unavailable");
      opts.order?.push(`clear:${id}`);
      cleared.push(id);
      return true;
    },
  };
}

function fakeSchedules(
  schedules: Record<string, Schedule[]>,
  opts: Recorder = {},
) {
  const updated: { id: string; enabled: boolean }[] = [];
  const cancelled: string[] = [];
  const boot = {
    repo: {
      async list(agentId: string) {
        return (schedules[agentId] ?? []) as never;
      },
      async updateSpec(
        id: string,
        _owner: string,
        spec: { type: string; enabled: boolean },
      ) {
        if (opts.failing?.includes(id))
          throw new Error("schedule write failed");
        opts.order?.push(`update:${id}`);
        updated.push({ id, enabled: spec.enabled });
        return { id } as never;
      },
    },
    runner: {
      async cancel(id: string) {
        opts.order?.push(`cancel:${id}`);
        cancelled.push(id);
      },
    },
  } as unknown as Pick<SchedulesBoot, "repo" | "runner">;
  const pauses: string[] = [];
  const pause = (agentId: string, owner: string) => {
    pauses.push(agentId);
    return pauseEnabledRecurringSchedules(boot, agentId, owner);
  };
  return { boot, pause, pauses, updated, cancelled };
}

describe("clearLegacyDisabledMarks", () => {
  // TEST_SCENARIO: the pause lands before the mark goes, so a fire held while the Agent was disabled has nothing to start from; a one-time task and an already paused schedule are left as they are.
  it("pauses a marked Agent's schedules and then clears it, in that order", async () => {
    const order: string[] = [];
    const repo = fakeRepo([{ id: "a1", owner: "o1", disabled: true }], {
      order,
    });
    const { pause } = fakeSchedules(
      {
        a1: [
          { id: "live", spec: { type: "cron", enabled: true } },
          { id: "once", spec: { type: "once", enabled: true } },
          { id: "paused", spec: { type: "cron", enabled: false } },
        ],
      },
      { order },
    );

    expect(await clearLegacyDisabledMarks(repo, pause)).toBe(1);
    expect(order).toEqual(["update:live", "cancel:live", "clear:a1"]);
  });

  // TEST_SCENARIO: one Agent the store refuses to write must not cost the others their cleanup, and the next boot tries it again.
  it("carries on past an Agent whose write fails", async () => {
    const repo = fakeRepo(
      [
        { id: "a1", owner: "o1", disabled: true },
        { id: "a2", owner: "o1", disabled: true },
      ],
      { failing: ["a1"] },
    );
    const { pause } = fakeSchedules({}, {});

    expect(await clearLegacyDisabledMarks(repo, pause)).toBe(1);
    expect(repo.cleared).toEqual(["a2"]);
  });

  // TEST_SCENARIO: a pause that fails could leave a schedule about to run on an Agent the cleanup just woke, so the mark stays and the next boot pauses again.
  it("leaves the mark when the pause fails", async () => {
    const repo = fakeRepo([{ id: "a1", owner: "o1", disabled: true }]);
    const { pause } = fakeSchedules(
      { a1: [{ id: "live", spec: { type: "cron", enabled: true } }] },
      { failing: ["live"] },
    );

    expect(await clearLegacyDisabledMarks(repo, pause)).toBe(0);
    expect(repo.cleared).toEqual([]);
  });

  // TEST_SCENARIO: a fleet with nothing marked costs one listing and no writes, so no schedule of an Agent nobody disabled is touched.
  it("writes nothing when nothing is marked", async () => {
    const repo = fakeRepo([{ id: "a1", owner: "o1", disabled: false }]);
    const { pause, pauses } = fakeSchedules(
      { a1: [{ id: "live", spec: { type: "cron", enabled: true } }] },
      {},
    );

    expect(await clearLegacyDisabledMarks(repo, pause)).toBe(0);
    expect(repo.cleared).toEqual([]);
    expect(pauses).toEqual([]);
  });
});

describe("pauseEnabledRecurringSchedules", () => {
  // TEST_SCENARIO: an enabled recurring schedule is paused with the same two writes a pause by hand makes — the spec says disabled and the queued fire is dropped — and nothing else is touched.
  it("pauses only the enabled recurring schedules", async () => {
    const { boot, updated, cancelled } = fakeSchedules({
      a1: [
        { id: "live", spec: { type: "cron", enabled: true } },
        { id: "once", spec: { type: "once", enabled: true } },
        { id: "paused", spec: { type: "cron", enabled: false } },
      ],
    });

    expect(await pauseEnabledRecurringSchedules(boot, "a1", "o1")).toBe(1);
    expect(updated).toEqual([{ id: "live", enabled: false }]);
    expect(cancelled).toEqual(["live"]);
  });
});
