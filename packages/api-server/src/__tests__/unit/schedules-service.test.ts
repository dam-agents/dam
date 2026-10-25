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

function makeDeps(
  current: Schedule,
  validateSessionChoices?: (
    agentId: string,
    choices: {
      harness?: string;
      model?: string;
      settings?: Record<string, string>;
    },
  ) => Promise<string | undefined>,
) {
  let savedSpec: ScheduleSpec | undefined;
  let cleared = 0;
  const repo = {
    async get(id: string) {
      return id === current.id ? current : null;
    },
    /** UNIT_BOUNDARY_DESCRIPTION: what the row stores, which for a profile
     * schedule is the reference alone. */
    async getRaw(id: string) {
      if (id !== current.id) return null;
      if (current.spec.profile === undefined) return current;
      const {
        harness: _harness,
        model: _model,
        settings: _settings,
        ...spec
      } = current.spec;
      return { ...current, spec } as Schedule;
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
    ownedProfile: async () => true,
    ...(validateSessionChoices ? { validateSessionChoices } : {}),
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

describe("updateRRule on a cron schedule", () => {
  // TEST_SCENARIO: converting a cron schedule saves it as an RRULE, so the cron expression must not stay behind in the spec and every other setting must carry over.
  it("saves it as an RRULE without the cron expression", async () => {
    const cron: Schedule = {
      id: SCHEDULE_ID,
      agentId: "agent-1",
      name: "daily",
      spec: {
        version: "1",
        type: "cron",
        cron: "0 9 * * *",
        task: "do the thing",
        precheck: "check.sh",
        enabled: false,
        sessionMode: "continuous",
        createdBy: "user",
      },
    };
    const { service, getSavedSpec } = makeDeps(cron);

    await service.updateRRule({
      ...baseUpdate,
      timezone: "UTC",
      sessionMode: "continuous",
      precheck: "check.sh",
    });

    expect(getSavedSpec()).toEqual({
      version: "1",
      type: "rrule",
      rrule: RRULE,
      timezone: "UTC",
      quietHours: [],
      task: "do the thing",
      precheck: "check.sh",
      enabled: false,
      sessionMode: "continuous",
      createdBy: "user",
    });
  });
});

describe("updateCron", () => {
  const cronSchedule = (): Schedule => ({
    id: SCHEDULE_ID,
    agentId: "agent-1",
    name: "daily",
    spec: {
      version: "1",
      type: "cron",
      cron: "0 9 * * *",
      task: "do the thing",
      precheck: "check.sh",
      enabled: false,
      sessionMode: "continuous",
      createdBy: "user",
    },
  });
  const cronUpdate = {
    id: SCHEDULE_ID,
    name: "weekdays",
    cron: "30 7 * * 1-5",
    task: "do the other thing",
  };

  // TEST_SCENARIO: a cron schedule stays a cron schedule when its owner edits it, so the new expression and fields land in the spec and its enabled state is kept.
  it("saves the new expression and fields on a cron schedule", async () => {
    const { service, getSavedSpec } = makeDeps(cronSchedule());

    await service.updateCron({
      ...cronUpdate,
      sessionMode: "continuous",
      precheck: null,
    });

    expect(getSavedSpec()).toEqual({
      version: "1",
      type: "cron",
      cron: "30 7 * * 1-5",
      task: "do the other thing",
      enabled: false,
      sessionMode: "continuous",
      createdBy: "user",
    });
  });

  it("refuses an expression cron can't read", async () => {
    const { service, getSavedSpec } = makeDeps(cronSchedule());

    await expect(
      service.updateCron({ ...cronUpdate, cron: "every day" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getSavedSpec()).toBeUndefined();
  });

  // TEST_SCENARIO: a cron schedule carries the same session choices as any other, so an edit checks the harness, model and settings it ends up with and saves them.
  it("checks and saves a cron schedule's session choices", async () => {
    const checked: unknown[] = [];
    const { service, getSavedSpec } = makeDeps(cronSchedule(), async (_, c) => {
      checked.push(c);
      return undefined;
    });
    const choices = {
      harness: "codex",
      model: "openai/gpt-5.5",
      settings: { effort: "high" },
    };

    await service.updateCron({ ...cronUpdate, ...choices });

    expect(checked).toEqual([choices]);
    expect(getSavedSpec()).toMatchObject({ type: "cron", ...choices });
  });

  // TEST_SCENARIO: updateCron writes a cron expression, so it must not turn an RRULE schedule into a cron one.
  it("refuses an RRULE schedule", async () => {
    const { service, getSavedSpec } = makeDeps(makeCurrent());

    await expect(service.updateCron(cronUpdate)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(getSavedSpec()).toBeUndefined();
  });
});

describe("session choices on a schedule", () => {
  function makeCreateDeps(
    validateSessionChoices: (
      agentId: string,
      choices: {
        harness?: string;
        model?: string;
        settings?: Record<string, string>;
      },
    ) => Promise<string | undefined>,
  ) {
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
      validateSessionChoices,
    });
    return { service, getCreated: () => created };
  }

  const choices = {
    harness: "codex",
    model: "openai/gpt-5.5",
    settings: { effort: "high" },
  };

  /** TEST_SCENARIO: The schedule names a harness, a qualified model and a
   * setting the validator accepts, so the spec carries all three for the
   * fire. */
  it("saves the harness, model and settings the validator accepts", async () => {
    const checked: unknown[] = [];
    const { service, getCreated } = makeCreateDeps(async (agentId, c) => {
      checked.push([agentId, c]);
      return undefined;
    });

    await service.createRRule({
      name: "daily",
      agentId: "agent-1",
      rrule: RRULE,
      timezone: TIMEZONE,
      task: "do the thing",
      ...choices,
    });

    expect(checked).toEqual([["agent-1", choices]]);
    expect(getCreated()?.spec).toMatchObject(choices);
  });

  /** TEST_SCENARIO: The validator refuses the model (the agent holds no such
   * provider), so the schedule is not saved and the reason reaches the
   * caller. */
  it("refuses a schedule with the validator's reason", async () => {
    const { service, getCreated } = makeCreateDeps(
      async () => "this agent holds no openai provider",
    );

    await expect(
      service.createCron({
        name: "hourly",
        agentId: "agent-1",
        cron: "0 * * * *",
        task: "do the thing",
        model: "openai/gpt-5.5",
      }),
    ).rejects.toThrow(/holds no openai provider/);
    expect(getCreated()).toBeUndefined();
  });

  /** TEST_SCENARIO: A one-time task that continues its session keeps that
   * session's choices, so naming any of them is refused before the validator
   * is asked. */
  it("refuses choices on a task that continues its session", async () => {
    const { service } = makeCreateDeps(async () => {
      throw new Error("the validator must not run");
    });

    await expect(
      service.createOnce(
        {
          name: "later",
          agentId: "agent-1",
          task: "check back",
          timezone: "UTC",
          settings: { effort: "high" },
        },
        "agent",
        { sessionRef: "sess-1", mode: "continue" },
      ),
    ).rejects.toThrow(/keeps that session's harness, model and settings/);
  });

  /** TEST_SCENARIO: A migration cleared this schedule's model and left a note.
   * The owner picks a model again on edit: the new choices are checked, saved,
   * and the note is gone. */
  it("drops the migration note once the model is chosen again", async () => {
    const current = makeCurrent();
    current.spec = { ...current.spec, migrationNote: "model cleared" };
    const { service, getSavedSpec } = makeDeps(current, async () => undefined);

    await service.updateRRule({ ...baseUpdate, model: "ibm/gpt-5.5" });

    expect(getSavedSpec()?.model).toBe("ibm/gpt-5.5");
    expect(getSavedSpec()?.migrationNote).toBeUndefined();
  });

  /** TEST_SCENARIO: An edit that keeps the choices as they were is not
   * re-validated, so a schedule whose provider went away can still be renamed
   * or retimed. */
  it("skips the validator when the choices are unchanged", async () => {
    const current = makeCurrent();
    current.spec = { ...current.spec, model: "ibm/gpt-5.5" };
    const { service, getSavedSpec } = makeDeps(current, async () => {
      throw new Error("the validator must not run");
    });

    await service.updateRRule({
      ...baseUpdate,
      task: "do the other thing",
      model: "ibm/gpt-5.5",
    });

    expect(getSavedSpec()?.task).toBe("do the other thing");
  });

  /** TEST_SCENARIO: An API caller changes only the harness of a schedule
   * that keeps its model: the validator sees the harness together with the
   * stored model, so a harness that cannot run it is refused instead of
   * saved for the fire to fail on. */
  it("validates the merged choices on a partial update", async () => {
    const current = makeCurrent();
    current.spec = { ...current.spec, model: "anthropic/claude-sonnet-5-5" };
    const seen: unknown[] = [];
    const { service } = makeDeps(current, async (_agentId, choices) => {
      seen.push(choices);
      return "the codex harness cannot run on anthropic";
    });

    await expect(
      service.updateRRule({ ...baseUpdate, harness: "codex" }),
    ).rejects.toThrow(/codex harness cannot run on anthropic/);
    expect(seen).toEqual([
      { harness: "codex", model: "anthropic/claude-sonnet-5-5" },
    ]);
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
      async getRaw() {
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

describe("a schedule's profile", () => {
  const profiled = (): Schedule => ({
    ...makeCurrent(),
    spec: {
      ...makeCurrent().spec,
      profile: "profile-1",
      harness: "claude-code",
      model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    },
  });

  it("keeps the reference alone when an update names no choice", async () => {
    const { service, getSavedSpec } = makeDeps(profiled());
    await service.updateRRule({ ...baseUpdate, task: "another thing" });
    expect(getSavedSpec()?.profile).toBe("profile-1");
    /* UNIT_BOUNDARY_DESCRIPTION: the resolved values must not be frozen beside
     * the reference, or a later edit of the profile would never reach it. */
    expect(getSavedSpec()?.model).toBeUndefined();
    expect(getSavedSpec()?.harness).toBeUndefined();
  });

  it("replaces the reference when a profile is named", async () => {
    const { service, getSavedSpec } = makeDeps(profiled());
    await service.updateRRule({ ...baseUpdate, profile: "profile-2" });
    expect(getSavedSpec()?.profile).toBe("profile-2");
    expect(getSavedSpec()?.harness).toBeUndefined();
    expect(getSavedSpec()?.model).toBeUndefined();
  });

  it("detaches to the values it ran on when an inline flag is sent", async () => {
    const { service, getSavedSpec } = makeDeps(profiled());
    await service.updateRRule({ ...baseUpdate, model: "cb/other-model" });
    const saved = getSavedSpec();
    expect(saved?.profile).toBeUndefined();
    expect(saved?.harness).toBe("claude-code");
    expect(saved?.model).toBe("cb/other-model");
  });

  it("clears the reference on an explicit null, leaving it on the agent's default", async () => {
    const { service, getSavedSpec } = makeDeps(profiled());
    await service.updateRRule({ ...baseUpdate, profile: null });
    expect(getSavedSpec()?.profile).toBeUndefined();
    expect(getSavedSpec()?.model).toBeUndefined();
    expect(getSavedSpec()?.harness).toBeUndefined();
  });

  it("refuses a profile its owner does not hold", async () => {
    const { service } = makeDeps(profiled());
    const scoped = createSchedulesService({
      repo: {
        async get() {
          return profiled();
        },
        async getRaw() {
          return profiled();
        },
      } as unknown as SchedulesRepository,
      runner: { async sync() {} } as unknown as SchedulerRunner,
      owner: OWNER,
      agentBinding: "*",
      ownedProfile: async (id) => id === "profile-1",
    });
    await expect(
      scoped.updateRRule({ ...baseUpdate, profile: "profile-other" }),
    ).rejects.toMatchObject({ message: "unknown profile" });
    void service;
  });

  it("records the profile a create names, and no inline values", async () => {
    let created: ScheduleSpec | undefined;
    const service = createSchedulesService({
      repo: {
        async create(input: { spec: ScheduleSpec }) {
          created = input.spec;
          return { ...makeCurrent(), spec: input.spec };
        },
        async get() {
          return null;
        },
      } as unknown as SchedulesRepository,
      runner: { async sync() {} } as unknown as SchedulerRunner,
      owner: OWNER,
      agentBinding: "*",
      ownedProfile: async () => true,
    });
    await service.createRRule({
      name: "daily",
      agentId: "agent-1",
      rrule: RRULE,
      timezone: TIMEZONE,
      task: "do the thing",
      profile: "profile-1",
      harness: "claude-code",
      model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    });
    expect(created?.profile).toBe("profile-1");
    expect(created?.model).toBeUndefined();
    expect(created?.harness).toBeUndefined();
  });
});

describe("a schedule's profile ownership on every write", () => {
  const owned = new Set(["profile-1"]);
  function scoped(repoOverrides: Partial<SchedulesRepository> = {}) {
    return createSchedulesService({
      repo: {
        async get() {
          return null;
        },
        async getRaw() {
          return null;
        },
        async create(input: { spec: ScheduleSpec }) {
          return { ...makeCurrent(), spec: input.spec };
        },
        async updateSpec(_id: string, _owner: string, spec: ScheduleSpec) {
          return { ...makeCurrent(), spec };
        },
        async updateName() {
          return null;
        },
        async clearPrecheckStatus() {},
        ...repoOverrides,
      } as unknown as SchedulesRepository,
      runner: {
        async sync() {},
        async cancel() {},
      } as unknown as SchedulerRunner,
      owner: OWNER,
      agentBinding: "*",
      ownedProfile: async (id) => owned.has(id),
    });
  }
  const once = {
    name: "one",
    agentId: "agent-1",
    at: "2026-10-26T09:00",
    timezone: TIMEZONE,
    task: "do it",
  };

  it("refuses another owner's profile on a cron create", async () => {
    await expect(
      scoped().createCron({
        name: "daily",
        agentId: "agent-1",
        cron: "0 3 * * *",
        task: "do it",
        profile: "profile-other",
      }),
    ).rejects.toMatchObject({ message: "unknown profile" });
  });

  it("refuses another owner's profile on a one-time create", async () => {
    await expect(
      scoped().createOnce({ ...once, profile: "profile-other" }),
    ).rejects.toMatchObject({ message: "unknown profile" });
  });

  it("refuses another owner's profile on a one-time update", async () => {
    await expect(
      scoped({
        async get() {
          return {
            ...makeCurrent(),
            spec: {
              ...makeCurrent().spec,
              type: "once",
              at: "2026-10-26T09:00:00.000Z",
            },
          } as Schedule;
        },
        async getRaw() {
          return {
            ...makeCurrent(),
            spec: {
              ...makeCurrent().spec,
              type: "once",
              at: "2026-10-26T09:00:00.000Z",
            },
          } as Schedule;
        },
      }).updateOnce({ ...once, id: SCHEDULE_ID, profile: "profile-other" }),
    ).rejects.toMatchObject({ message: "unknown profile" });
  });

  it("clears the profile when a schedule is moved to the agent's default", async () => {
    let saved: ScheduleSpec | undefined;
    const service = scoped({
      async get() {
        return {
          ...makeCurrent(),
          spec: { ...makeCurrent().spec, profile: "profile-1" },
        } as Schedule;
      },
      async getRaw() {
        return {
          ...makeCurrent(),
          spec: { ...makeCurrent().spec, profile: "profile-1" },
        } as Schedule;
      },
      async updateSpec(_id: string, _owner: string, spec: ScheduleSpec) {
        saved = spec;
        return { ...makeCurrent(), spec };
      },
    });
    await service.clearSessionChoices(SCHEDULE_ID);
    expect(saved?.profile).toBeUndefined();
  });
});

describe("a profile schedule saved from a form", () => {
  const profiled = (): Schedule => ({
    ...makeCurrent(),
    spec: {
      ...makeCurrent().spec,
      profile: "profile-1",
      harness: "claude-code",
      model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
      settings: { effort: "high" },
    },
  });
  const resolved = {
    harness: "claude-code",
    model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    settings: { effort: "high" },
  };

  /** TEST_SCENARIO: The web form pre-fills the resolved values and sends them
   * back, blank or not, on every save; a task-only edit must keep the profile. */
  it("keeps the reference when the form repeats the resolved values", async () => {
    const { service, getSavedSpec } = makeDeps(profiled());
    await service.updateRRule({
      ...baseUpdate,
      task: "another thing",
      ...resolved,
    });
    expect(getSavedSpec()?.profile).toBe("profile-1");
    expect(getSavedSpec()?.model).toBeUndefined();
  });

  it("keeps the reference when the form sends blanks", async () => {
    const { service, getSavedSpec } = makeDeps(profiled());
    await service.updateRRule({
      ...baseUpdate,
      harness: null,
      model: null,
      settings: null,
    });
    expect(getSavedSpec()?.profile).toBe("profile-1");
    expect(getSavedSpec()?.harness).toBeUndefined();
  });

  it("detaches on a value that differs, keeping what the profile gave", async () => {
    const { service, getSavedSpec } = makeDeps(profiled());
    await service.updateRRule({
      ...baseUpdate,
      ...resolved,
      model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-2030",
    });
    const saved = getSavedSpec();
    expect(saved?.profile).toBeUndefined();
    expect(saved?.harness).toBe("claude-code");
    expect(saved?.model).toBe("cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-2030");
  });

  /** TEST_SCENARIO: A schedule whose profile cannot run shows the form blank;
   * saving the task must not drop the reference and quietly fall back. */
  it("keeps the reference of a profile that cannot run on a task-only edit", async () => {
    const unavailable: Schedule = {
      ...makeCurrent(),
      spec: { ...makeCurrent().spec, profile: "profile-1" },
      profileIssue: "CurveBender (shared) is not connected",
    };
    const { service, getSavedSpec } = makeDeps(unavailable);
    await service.updateRRule({
      ...baseUpdate,
      task: "another thing",
      harness: null,
      model: null,
      settings: null,
    });
    expect(getSavedSpec()?.profile).toBe("profile-1");
  });
});
