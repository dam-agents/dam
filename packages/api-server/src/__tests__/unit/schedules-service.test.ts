import { describe, it, expect } from "vitest";
import type { Schedule, ScheduleSpec } from "api-server-api";
import { createSchedulesService } from "../../modules/schedules/services/schedules-service.js";
import type { SchedulesRepository } from "../../modules/schedules/infrastructure/schedules-repository.js";
import type {
  RunNowResult,
  SchedulerRunner,
} from "../../modules/schedules/services/scheduler-runner.js";

const OWNER = "owner-1";
const SCHEDULE_ID = "sched-1";
const RRULE = "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0";
const TIMEZONE = "Europe/Prague";

function makeCurrent(
  sessionMode?: "continuous" | "fresh",
  precheck?: string,
): Schedule {
  const spec: ScheduleSpec = {
    version: "1",
    type: "rrule",
    rrule: RRULE,
    timezone: TIMEZONE,
    task: "do the thing",
    enabled: true,
    createdBy: "user",
    ...(sessionMode ? { sessionMode } : {}),
    ...(precheck ? { precheck } : {}),
  };
  return { id: SCHEDULE_ID, agentId: "agent-1", name: "daily", spec };
}

function makeDeps(current: Schedule) {
  let savedSpec: ScheduleSpec | undefined;
  let cleared = 0;
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
    async clearPrecheckStatus() {
      cleared += 1;
    },
  } as unknown as SchedulesRepository;
  const runner = { async sync() {} } as unknown as SchedulerRunner;
  const service = createSchedulesService({
    repo,
    runner,
    owner: OWNER,
    agentBinding: "*",
  });
  return { service, getSavedSpec: () => savedSpec, getCleared: () => cleared };
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
  function makeCreateDeps() {
    let created:
      { agentId: string; owner: string; spec: ScheduleSpec } | undefined;
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
    const service = createSchedulesService({
      repo,
      runner,
      owner: OWNER,
      agentBinding: "*",
    });
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

describe("listForOwner", () => {
  interface SeenOpts {
    limit?: number;
    agentIds?: readonly string[];
  }

  function makeListDeps(agentBinding: readonly string[] | "*") {
    const seen: { owner: string; opts?: SeenOpts }[] = [];
    const repo = {
      async listForOwner(owner: string, opts?: SeenOpts) {
        seen.push({ owner, opts });
        return [];
      },
    } as unknown as SchedulesRepository;
    const runner = { async sync() {} } as unknown as SchedulerRunner;
    return {
      service: createSchedulesService({
        repo,
        runner,
        owner: OWNER,
        agentBinding,
      }),
      seen,
    };
  }

  // TEST_SCENARIO: an owner-wide read is an authorization boundary a smoke test cannot cover.
  it("asks the repository only for the caller's own schedules", async () => {
    const { service, seen } = makeListDeps("*");

    await service.listForOwner();
    await service.listForOwner(5);

    expect(seen).toEqual([
      { owner: OWNER, opts: {} },
      { owner: OWNER, opts: { limit: 5 } },
    ]);
  });

  // TEST_SCENARIO: an agent-bound API key must not read schedules for agents it is refused on.
  // TEST_SCENARIO: the binding has to reach the query, or a limit applied first can hide the
  // TEST_SCENARIO: caller's own rows behind rows it is not allowed to see.
  it("narrows the query itself to an agent-bound caller's binding", async () => {
    const bound = makeListDeps(["agent-1"]);
    const unbound = makeListDeps("*");

    await bound.service.listForOwner(5);
    await unbound.service.listForOwner(5);

    expect(bound.seen).toEqual([
      { owner: OWNER, opts: { limit: 5, agentIds: ["agent-1"] } },
    ]);
    expect(unbound.seen).toEqual([{ owner: OWNER, opts: { limit: 5 } }]);
  });
});

describe("updateRRule precheck status", () => {
  // TEST_SCENARIO: an error recorded against one command says nothing about another, so editing the precheck must drop what the old one produced.
  it("clears the recorded status when the precheck changes", async () => {
    const { service, getCleared } = makeDeps(makeCurrent(undefined, "old.sh"));

    await service.updateRRule({ ...baseUpdate, precheck: "new.sh" });

    expect(getCleared()).toBe(1);
  });

  // TEST_SCENARIO: an unchanged precheck keeps its history, or every unrelated edit would wipe the count the owner reads.
  it("keeps the status when the precheck is untouched", async () => {
    const { service, getCleared } = makeDeps(makeCurrent(undefined, "same.sh"));

    await service.updateRRule({ ...baseUpdate, precheck: "same.sh" });

    expect(getCleared()).toBe(0);
  });
});

// TEST_SCENARIO: an enabled schedule with no next run has stopped for good, so a read names why instead of leaving the owner a bare last result; the reason is derived on read, so a repaired and re-armed schedule shows none.
describe("stop reason", () => {
  function withRule(rrule: string, nextRun?: string): Schedule {
    const current = makeCurrent();
    return {
      ...current,
      spec: { ...current.spec, rrule } as ScheduleSpec,
      ...(nextRun ? { status: { nextRun } } : {}),
    };
  }

  it("names why an enabled schedule has no next run", async () => {
    const { service } = makeDeps(withRule("FREQ=DAILY;UNTIL=20200101T000000Z"));
    const schedule = await service.get(SCHEDULE_ID);
    expect(schedule?.status?.stopReason).toBe("it has no more occurrences");
  });

  it("names none for an armed schedule", async () => {
    const { service } = makeDeps(withRule(RRULE, "2026-10-01T07:00:00.000Z"));
    const schedule = await service.get(SCHEDULE_ID);
    expect(schedule?.status?.stopReason).toBeUndefined();
  });

  it("names none for a paused schedule", async () => {
    const current = withRule("FREQ=DAILY;UNTIL=20200101T000000Z");
    const { service } = makeDeps({
      ...current,
      spec: { ...current.spec, enabled: false },
    });
    const schedule = await service.get(SCHEDULE_ID);
    expect(schedule?.status?.stopReason).toBeUndefined();
  });
});

describe("runNow", () => {
  function makeRunNowDeps(opts?: { found?: boolean; outcome?: RunNowResult }) {
    const ran: string[] = [];
    const repo = {
      async get() {
        return opts?.found === false ? null : makeCurrent();
      },
    } as unknown as SchedulesRepository;
    const runner = {
      async runNow(id: string) {
        ran.push(id);
        return opts?.outcome ?? "started";
      },
    } as unknown as SchedulerRunner;
    return {
      service: createSchedulesService({
        repo,
        runner,
        owner: OWNER,
        agentBinding: "*",
      }),
      ran,
    };
  }

  // TEST_SCENARIO: the repository read is the ownership check — the runner takes a bare id, so a caller who does not own the schedule must be refused before it is reached.
  it("refuses a schedule the caller does not own", async () => {
    const { service, ran } = makeRunNowDeps({ found: false });

    await expect(service.runNow(SCHEDULE_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(ran).toEqual([]);
  });

  it("asks the runner to fire the owned schedule", async () => {
    const { service, ran } = makeRunNowDeps();

    await service.runNow(SCHEDULE_ID);

    expect(ran).toEqual([SCHEDULE_ID]);
  });

  // TEST_SCENARIO: a scheduled fire on an Agent still onboarding is held with nobody watching; here a user asked for it, so the refusal has to reach them rather than reading as a run that started.
  it("reports a refused fire to the caller", async () => {
    const { service } = makeRunNowDeps({ outcome: "onboarding-pending" });

    await expect(service.runNow(SCHEDULE_ID)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("toggle", () => {
  function makeToggleDeps() {
    let stored = makeCurrent();
    const armed: string[] = [];
    const repo = {
      async get() {
        return stored;
      },
      async updateSpec(_id: string, _owner: string, spec: ScheduleSpec) {
        stored = { ...stored, spec };
        return stored;
      },
    } as unknown as SchedulesRepository;
    const runner = {
      async sync(id: string) {
        armed.push(`sync ${id}`);
      },
      async cancel(id: string) {
        armed.push(`cancel ${id}`);
      },
    } as unknown as SchedulerRunner;
    return {
      service: createSchedulesService({
        repo,
        runner,
        owner: OWNER,
        agentBinding: "*",
      }),
      armed,
    };
  }

  // TEST_SCENARIO: a disable whose response was lost is re-sent by the user, or sent again from a second stale tab; the repeat must not re-enable the schedule.
  it("keeps a schedule disabled when the disable is sent twice", async () => {
    const { service, armed } = makeToggleDeps();

    await service.toggle(SCHEDULE_ID, false);
    const again = await service.toggle(SCHEDULE_ID, false);

    expect(again?.spec.enabled).toBe(false);
    expect(armed).toEqual([`cancel ${SCHEDULE_ID}`, `cancel ${SCHEDULE_ID}`]);
  });

  // TEST_SCENARIO: CLI releases that predate the target state send only the id, and must still pause and resume.
  it("flips the state when no target is sent", async () => {
    const { service } = makeToggleDeps();

    const paused = await service.toggle(SCHEDULE_ID);
    const resumed = await service.toggle(SCHEDULE_ID);

    expect([paused?.spec.enabled, resumed?.spec.enabled]).toEqual([
      false,
      true,
    ]);
  });
});
