import { describe, it, expect } from "vitest";
import type { Schedule, ScheduleSpec } from "api-server-api";
import { createSchedulesService } from "../../modules/schedules/services/schedules-service.js";
import type { SchedulesRepository } from "../../modules/schedules/infrastructure/schedules-repository.js";
import type { SchedulerRunner } from "../../modules/schedules/services/scheduler-runner.js";

const OWNER = "owner-1";
const SCHEDULE_ID = "sched-1";
const RRULE = "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0";
const TIMEZONE = "Europe/Prague";

function makeCurrent(sessionMode?: "continuous" | "fresh"): Schedule {
  const spec: ScheduleSpec = {
    version: "1",
    type: "rrule",
    rrule: RRULE,
    timezone: TIMEZONE,
    task: "do the thing",
    enabled: true,
    createdBy: "user",
    ...(sessionMode ? { sessionMode } : {}),
  };
  return { id: SCHEDULE_ID, agentId: "agent-1", name: "daily", spec };
}

/** Fake repo that returns `current` from get() and captures the spec passed to
 *  updateSpec(), plus a no-op runner. */
function makeDeps(current: Schedule) {
  let savedSpec: ScheduleSpec | undefined;
  const repo = {
    async get(id: string) {
      return id === current.id ? current : null;
    },
    async updateName() {
      return current;
    },
    async updateSpec(_id: string, _owner: string, spec: ScheduleSpec) {
      savedSpec = spec;
      return { ...current, spec };
    },
  } as unknown as SchedulesRepository;
  const runner = { async sync() {} } as unknown as SchedulerRunner;
  const service = createSchedulesService({ repo, runner, owner: OWNER });
  return { service, getSavedSpec: () => savedSpec };
}

const baseUpdate = {
  id: SCHEDULE_ID,
  name: "daily",
  rrule: RRULE,
  timezone: TIMEZONE,
  quietHours: [],
  task: "do the thing",
};

describe("updateRRule sessionMode", () => {
  it("clears sessionMode when switching from continuous to fresh", async () => {
    const { service, getSavedSpec } = makeDeps(makeCurrent("continuous"));

    await service.updateRRule({ ...baseUpdate, sessionMode: undefined });

    expect(getSavedSpec()?.sessionMode).toBeUndefined();
  });

  it("sets sessionMode when switching from fresh to continuous", async () => {
    const { service, getSavedSpec } = makeDeps(makeCurrent(undefined));

    await service.updateRRule({ ...baseUpdate, sessionMode: "continuous" });

    expect(getSavedSpec()?.sessionMode).toBe("continuous");
  });
});

describe("createRRule createdBy", () => {
  /** Fake repo whose create() captures the spec it was asked to persist. */
  function makeCreateDeps() {
    let created:
      | { agentId: string; owner: string; spec: ScheduleSpec }
      | undefined;
    const repo = {
      async create(input: {
        agentId: string;
        owner: string;
        name: string;
        spec: ScheduleSpec;
      }) {
        created = input;
        return {
          id: SCHEDULE_ID,
          agentId: input.agentId,
          name: input.name,
          spec: input.spec,
        };
      },
    } as unknown as SchedulesRepository;
    const runner = { async sync() {} } as unknown as SchedulerRunner;
    const service = createSchedulesService({ repo, runner, owner: OWNER });
    return { service, getCreated: () => created };
  }

  const baseCreate = {
    name: "daily",
    agentId: "agent-1",
    rrule: RRULE,
    timezone: TIMEZONE,
    task: "do the thing",
  };

  it("defaults to createdBy 'user' when omitted, like createCron", async () => {
    const { service, getCreated } = makeCreateDeps();

    await service.createRRule(baseCreate);

    expect(getCreated()?.spec.createdBy).toBe("user");
  });

  it("labels a schedule an agent registers on itself as createdBy 'agent'", async () => {
    const { service, getCreated } = makeCreateDeps();

    await service.createRRule(baseCreate, "agent");

    expect(getCreated()?.spec.createdBy).toBe("agent");
  });
});
