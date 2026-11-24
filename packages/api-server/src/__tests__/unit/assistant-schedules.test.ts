// TEST_OVERVIEW: a Schedule the platform gives one owner's assistant, shown on the security check, its first kind. Turning it on gives their assistant one weekly Schedule and records it; a person with no assistant is refused; a Schedule that still stands is left alone and a deleted one is made again only by the switch. Turning it off deletes the Schedule and the last report. The install's mode wins over a switch. A Schedule made by an earlier release gets the current task and the current name where it still has that release's, and keeps the time and a name its owner gave it. The owner's level decides the task of a run and leaves the Schedule's own settings alone: only the top level lets the assistant ask other Agents, a record from before the choice asks none, and an owner who chose no check keeps none. The assistant's report replaces the one before it, is kept only for a person the feature is on for, and is shown only while it names a problem, its Schedule stands and the owner still has the Agent.
import type { FeatureMode, Schedule, SchedulesService } from "api-server-api";
import { describe, expect, it, vi } from "vitest";

import { securityCheckSchedule } from "../../modules/assistant-schedules/domain/security-check.js";
import type {
  AssistantScheduleRow,
  AssistantSchedulesRepository,
} from "../../modules/assistant-schedules/infrastructure/assistant-schedules-repository.js";
import { createAssistantSchedule } from "../../modules/assistant-schedules/services/assistant-schedule-service.js";

const OWNER = "owner-1";
const KIND = securityCheckSchedule.kind;
const NOW = new Date("2026-11-17T09:00:00.000Z");
const LATER = new Date("2026-11-17T09:30:00.000Z");

function memoryRepo(): AssistantSchedulesRepository & {
  row: (kind?: string) => AssistantScheduleRow | null;
  failNextSave: () => void;
} {
  const stored = new Map<string, AssistantScheduleRow>();
  let saveFails = false;
  return {
    row: (kind = KIND) => stored.get(kind) ?? null,
    failNextSave: () => {
      saveFails = true;
    },
    find: async (_owner, kind) => stored.get(kind) ?? null,
    save: async (_owner, kind, schedule) => {
      if (saveFails) {
        saveFails = false;
        throw new Error("database unavailable");
      }
      stored.set(kind, { ...schedule, items: [], reportedAt: null });
    },
    setLevel: async (_owner, kind, level) => {
      const row = stored.get(kind);
      if (row !== undefined) stored.set(kind, { ...row, level });
    },
    report: async (_owner, kind, items, when) => {
      const row = stored.get(kind);
      if (row === undefined) return null;
      const next = {
        ...row,
        items: [...items],
        reportedAt: when.keepTime ? (row.reportedAt ?? when.at) : when.at,
      };
      stored.set(kind, next);
      return next;
    },
    delete: async (_owner, kind) => {
      stored.delete(kind);
    },
    listAgentIds: async () => [...stored.values()].map((row) => row.agentId),
    deleteForAgent: async () => {
      stored.clear();
    },
  };
}

function world(
  opts: {
    assistant?: string | null;
    enabled?: boolean;
    owned?: boolean;
    mode?: FeatureMode;
  } = {},
) {
  const schedules = new Map<string, Schedule>();
  const state: {
    assistant: string | null | undefined;
    now: Date;
    beforeLockedWork?: () => Promise<void>;
  } = { assistant: opts.assistant, now: NOW };
  const lockCalls = { count: 0 };
  const lock = async <T>(_key: string, work: () => Promise<T>): Promise<T> => {
    lockCalls.count += 1;
    await state.beforeLockedWork?.();
    return work();
  };
  let made = 0;
  const createRRule = vi.fn(
    async (input: Parameters<SchedulesService["createRRule"]>[0]) => {
      made += 1;
      const schedule: Schedule = {
        id: `schedule-${String(made)}`,
        name: input.name,
        agentId: input.agentId,
        spec: {
          version: "1",
          type: "rrule",
          rrule: input.rrule,
          timezone: input.timezone,
          task: input.task,
          enabled: true,
          createdBy: "user",
          ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
          ...(input.settings ? { settings: input.settings } : {}),
          ...(input.sessionTitle ? { sessionTitle: input.sessionTitle } : {}),
        },
      };
      schedules.set(schedule.id, schedule);
      return schedule;
    },
  );
  const updateRRule = vi.fn(
    async (input: Parameters<SchedulesService["updateRRule"]>[0]) => {
      const current = schedules.get(input.id);
      if (current === undefined || current.spec.type !== "rrule") return null;
      const updated: Schedule = {
        ...current,
        name: input.name,
        spec: {
          ...current.spec,
          rrule: input.rrule,
          timezone: input.timezone,
          task: input.task,
          ...(input.settings ? { settings: input.settings } : {}),
          ...(input.sessionTitle ? { sessionTitle: input.sessionTitle } : {}),
        },
      };
      schedules.set(updated.id, updated);
      return updated;
    },
  );
  const deleteSchedule = vi.fn(async (id: string) => {
    schedules.delete(id);
  });
  const repo = memoryRepo();
  const scheduleFor = (
    definition = securityCheckSchedule,
  ): ReturnType<typeof createAssistantSchedule> =>
    createAssistantSchedule({
      definition,
      owner: OWNER,
      repo,
      assistantName: "Ada",
      mode: opts.mode ?? "experimental",
      enabled: async () => opts.enabled ?? true,
      assistantAgentId: async () =>
        state.assistant === undefined ? "agent-ada" : state.assistant,
      ownsAgent: async () => opts.owned ?? true,
      schedules: {
        get: async (id) => schedules.get(id) ?? null,
        createRRule,
        updateRRule,
        delete: deleteSchedule,
      },
      lock,
      now: () => state.now,
    });
  return {
    checks: scheduleFor(),
    scheduleFor,
    state,
    lockCalls,
    repo,
    schedules,
    createRRule,
    updateRRule,
    deleteSchedule,
  };
}

describe("turning the security check on", () => {
  // TEST_SCENARIO: the switch gives the assistant one weekly Schedule in a fresh Session each time, at the owner's own minute of the week, and the record names it.
  it("gives the assistant a weekly schedule and records it", async () => {
    const w = world();
    await w.checks.enable();
    expect(w.createRRule).toHaveBeenCalledTimes(1);
    expect(w.createRRule.mock.calls[0]?.[0]).toMatchObject({
      name: "Security advisory",
      agentId: "agent-ada",
      rrule: securityCheckSchedule.rule(OWNER),
      timezone: "UTC",
      sessionMode: "fresh",
      sessionTitle: "Security advisory",
    });
    expect(w.repo.row()).toMatchObject({
      agentId: "agent-ada",
      scheduleId: "schedule-1",
    });
  });

  // TEST_SCENARIO: the Schedule's task is the assistant's whole instruction for the run, so it must name the advisory to judge by, the command that reports, and that nothing changes before the owner agrees.
  it("gives the run its procedure in the schedule's task", async () => {
    const w = world();
    await w.checks.enable();
    const task = w.createRRule.mock.calls[0]?.[0].task ?? "";
    expect(task).toContain("references/security-advisory.md");
    expect(task).toContain("dam security-check report");
    expect(task).toContain("change nothing until your owner agrees");
  });

  // TEST_SCENARIO: a person with no assistant has nothing to run the check on, so the switch is refused in words that name the install's assistant, and nothing is made.
  it("refuses a person who has no assistant", async () => {
    const w = world({ assistant: null });
    await expect(w.checks.enable()).rejects.toThrow("Turn Ada on first");
    expect(w.createRRule).not.toHaveBeenCalled();
    expect(w.repo.row()).toBeNull();
  });

  // TEST_SCENARIO: the Schedule the record names still stands on the assistant, so switching on again makes no second one and keeps the last report.
  it("leaves a schedule that still stands alone", async () => {
    const w = world();
    await w.checks.enable();
    await w.checks.report(["bot: shared sign-in"]);
    await w.checks.enable();
    expect(w.createRRule).toHaveBeenCalledTimes(1);
    expect(w.repo.row()?.items).toEqual(["bot: shared sign-in"]);
  });

  // TEST_SCENARIO: the owner deleted the Schedule, and the switch is the ask, so it makes one again and the report about the old one goes.
  it("makes the schedule again after the owner deleted it", async () => {
    const w = world();
    await w.checks.enable();
    await w.checks.report(["bot: shared sign-in"]);
    w.schedules.clear();
    await w.checks.enable();
    expect(w.createRRule).toHaveBeenCalledTimes(2);
    expect(w.repo.row()).toMatchObject({
      scheduleId: "schedule-2",
      items: [],
      reportedAt: null,
    });
  });

  // TEST_SCENARIO: the Schedule was made but its record could not be written, so the Schedule is deleted again: none is left to run with nothing naming it.
  it("leaves no schedule behind when the record cannot be written", async () => {
    const w = world();
    w.repo.failNextSave();
    await expect(w.checks.enable()).rejects.toThrow("database unavailable");
    expect(w.schedules.size).toBe(0);
    expect(w.repo.row()).toBeNull();
  });

  // TEST_SCENARIO: the install turned the feature off, so a flag written anyway gives no Schedule that would spend the owner's budget unseen.
  it("gives nothing where the install turned the feature off", async () => {
    const w = world({ mode: "off" });
    await w.checks.enable();
    expect(w.createRRule).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the minute of the week comes from the owner, so one person's check keeps its time and the rule is a weekly one the Schedule accepts.
  it("derives a stable weekly rule from the owner", () => {
    expect(securityCheckSchedule.rule(OWNER)).toBe(
      securityCheckSchedule.rule(OWNER),
    );
    expect(securityCheckSchedule.rule(OWNER)).toMatch(
      /^FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU);BYHOUR=([01]?\d|2[0-3]);BYMINUTE=[0-5]?\d$/,
    );
    expect(
      new Set(
        ["a", "b", "c", "d", "e", "f"].map((owner) =>
          securityCheckSchedule.rule(owner),
        ),
      ).size,
    ).toBeGreaterThan(1);
  });
});

describe("the check where nobody flipped a switch", () => {
  // TEST_SCENARIO: an install that pins the feature on gives each person the Schedule once; one they deleted stays deleted, since no switch asked for it again.
  it("gives the schedule once", async () => {
    const w = world();
    await w.checks.ensure();
    w.schedules.clear();
    await w.checks.ensure();
    expect(w.createRRule).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: this runs on each request of a person, and nearly always there is nothing to make: the record and the assistant agree, so it takes no lock.
  it("takes no lock when nothing is owed", async () => {
    const w = world();
    await w.checks.ensure();
    w.lockCalls.count = 0;
    await w.checks.ensure();
    expect(w.lockCalls.count).toBe(0);
  });

  // TEST_SCENARIO: two requests both see that a Schedule is owed; the one that waited for the lock reads again inside it, finds the other's Schedule, and makes no second one.
  it("makes no second schedule when another request made it first", async () => {
    const w = world();
    w.state.beforeLockedWork = async () => {
      w.state.beforeLockedWork = undefined;
      await w.checks.ensure();
    };
    await w.checks.ensure();
    expect(w.createRRule).toHaveBeenCalledTimes(1);
    expect(w.schedules.size).toBe(1);
  });

  // TEST_SCENARIO: the platform made the person's assistant again, so the Schedule went with the old Agent; the check follows to the new one and starts without the old report.
  it("follows the assistant when it is made again", async () => {
    const w = world();
    await w.checks.ensure();
    await w.checks.report(["bot: shared sign-in"]);
    w.schedules.clear();
    w.state.assistant = "agent-ada-2";
    await w.checks.ensure();
    expect(w.repo.row()).toMatchObject({
      agentId: "agent-ada-2",
      scheduleId: "schedule-2",
      items: [],
    });
  });

  // TEST_SCENARIO: the person has no assistant now, so nothing is made and the record is left for the cleanup of the Agent it names.
  it("makes nothing while there is no assistant", async () => {
    const w = world({ assistant: null });
    await w.checks.ensure();
    expect(w.createRRule).not.toHaveBeenCalled();
  });
});

describe("a schedule made by an earlier release", () => {
  const madeEarlier = (w: ReturnType<typeof world>): void => {
    const schedule = w.schedules.get("schedule-1");
    if (schedule?.spec.type !== "rrule") throw new Error("no schedule made");
    w.schedules.set(schedule.id, {
      ...schedule,
      name: "My Monday check",
      spec: {
        ...schedule.spec,
        task: "the procedure of an earlier release",
        rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=0",
        timezone: "Europe/Prague",
      },
    });
  };

  // TEST_SCENARIO: the Schedule holds an older task under a name and a time the owner gave it, so a refresh puts the current task there and sends the name, the time and the session mode back unchanged.
  it("gets the current task and keeps the owner's name and time", async () => {
    const w = world();
    await w.checks.enable();
    madeEarlier(w);
    await w.checks.refresh();
    expect(w.updateRRule).toHaveBeenCalledTimes(1);
    expect(w.updateRRule).toHaveBeenCalledWith({
      id: "schedule-1",
      name: "My Monday check",
      rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=0",
      timezone: "Europe/Prague",
      task: securityCheckSchedule.task("standard"),
      sessionMode: "fresh",
    });
    expect(w.schedules.get("schedule-1")?.spec.task).toBe(
      securityCheckSchedule.task("standard"),
    );
  });

  // TEST_SCENARIO: an earlier release named the Schedule and its Sessions "Security check", and the owner left both as they were, so a refresh gives them the current name though the task is current.
  it("gets the current name when it still has an earlier release's", async () => {
    const w = world();
    await w.checks.enable();
    const schedule = w.schedules.get("schedule-1");
    if (schedule?.spec.type !== "rrule") throw new Error("no schedule made");
    w.schedules.set(schedule.id, {
      ...schedule,
      name: "Security check",
      spec: { ...schedule.spec, sessionTitle: "Security check" },
    });
    await w.checks.refresh();
    expect(w.schedules.get("schedule-1")).toMatchObject({
      name: "Security advisory",
      spec: { sessionTitle: "Security advisory" },
    });
  });

  // TEST_SCENARIO: the Schedule already holds the current task, so a refresh writes nothing and takes no lock.
  it("is left alone when its task is current", async () => {
    const w = world();
    await w.checks.enable();
    const locksBefore = w.lockCalls.count;
    await w.checks.refresh();
    expect(w.updateRRule).not.toHaveBeenCalled();
    expect(w.lockCalls.count).toBe(locksBefore);
  });

  // TEST_SCENARIO: another request brought the task up to date while this one waited for the lock, so this one writes nothing.
  it("is not written twice when another request refreshed it first", async () => {
    const w = world();
    await w.checks.enable();
    madeEarlier(w);
    w.state.beforeLockedWork = async () => {
      w.state.beforeLockedWork = undefined;
      await w.checks.refresh();
    };
    await w.checks.refresh();
    expect(w.updateRRule).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: a person the platform gave no check has nothing to refresh, and neither has one who deleted its Schedule.
  it("writes nothing for a person with no schedule of the check", async () => {
    const none = world();
    await none.checks.refresh();
    expect(none.updateRRule).not.toHaveBeenCalled();

    const deleted = world();
    await deleted.checks.enable();
    deleted.schedules.delete("schedule-1");
    await deleted.checks.refresh();
    expect(deleted.updateRRule).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the install turned the feature off, so the Schedule a person still has from before is not touched.
  it("is not touched where the install turned the feature off", async () => {
    const on = world();
    await on.checks.enable();
    madeEarlier(on);
    const off = world({ mode: "off" });
    off.schedules.set("schedule-1", on.schedules.get("schedule-1") as Schedule);
    await off.repo.save(OWNER, KIND, {
      agentId: "agent-ada",
      scheduleId: "schedule-1",
      level: null,
    });
    await off.checks.refresh();
    expect(off.updateRRule).not.toHaveBeenCalled();
  });
});

describe("the level of the check", () => {
  const ASKS_AGENTS = "dam run <agent> -p";
  const taskOf = (w: ReturnType<typeof world>): string => {
    const spec = w.schedules.get("schedule-1")?.spec;
    return spec?.task ?? "";
  };
  // TEST_SCENARIO: nobody chose a level, so the check the switch gives is the standard one, and it names no effort of its own. Its task has the assistant read the instruction files of shared Agents, which calls no model, and tells it to send no prompt to another Agent: a turn on another Agent is never spent unasked.
  it("asks no agent until the owner chooses the level that does", async () => {
    const w = world();
    await w.checks.enable();
    expect(await w.checks.level()).toBe("standard");
    expect(w.schedules.get("schedule-1")?.spec.settings).toBeUndefined();
    expect(taskOf(w)).toContain("dam file get <agent>");
    expect(taskOf(w)).toContain("Send no prompt to another agent");
    expect(taskOf(w)).not.toContain(ASKS_AGENTS);
  });

  // TEST_SCENARIO: the owner raises the check to the top level, so the Schedule that stands gets the task that asks each Agent others steer, under the name and time it had; no second Schedule is made.
  it("lets the check ask agents at the top level", async () => {
    const w = world();
    await w.checks.enable();
    await w.checks.enable("deep");
    expect(w.createRRule).toHaveBeenCalledTimes(1);
    expect(await w.checks.level()).toBe("deep");
    expect(taskOf(w)).toContain(ASKS_AGENTS);
    expect(taskOf(w)).toContain("Name in this chat each agent you asked");
  });

  // TEST_SCENARIO: the owner lowers the check from the top level, so the next run asks no Agent again.
  it("stops asking agents when the level is lowered", async () => {
    const w = world();
    await w.checks.enable("deep");
    await w.checks.enable("standard");
    expect(await w.checks.level()).toBe("standard");
    expect(taskOf(w)).not.toContain(ASKS_AGENTS);
  });

  // TEST_SCENARIO: the model and the effort of a run are the Schedule's own, so a new level changes the task and leaves the settings the owner put on the Schedule as they are.
  it("leaves the settings the owner put on the schedule", async () => {
    const w = world();
    await w.checks.enable();
    const schedule = w.schedules.get("schedule-1");
    if (schedule?.spec.type !== "rrule") throw new Error("no schedule made");
    w.schedules.set(schedule.id, {
      ...schedule,
      spec: { ...schedule.spec, settings: { effort: "low", cacheTtl: "1h" } },
    });
    await w.checks.enable("deep");
    expect(w.updateRRule.mock.calls[0]?.[0].settings).toBeUndefined();
    expect(w.schedules.get("schedule-1")?.spec.settings).toEqual({
      effort: "low",
      cacheTtl: "1h",
    });
  });

  // TEST_SCENARIO: an earlier release stored an effort as the level. Such a record is the standard check: it shows as that and its task asks no Agent.
  it("reads an effort level of an earlier release as the standard check", async () => {
    const w = world();
    await w.checks.enable("high");
    expect(w.repo.row()?.level).toBe("high");
    expect(taskOf(w)).toBe(securityCheckSchedule.task("standard"));
    expect(taskOf(w)).not.toContain(ASKS_AGENTS);
  });

  // TEST_SCENARIO: the owner chose no check, so its Schedule and last report go and the record stays. An install that pins the feature on then gives nothing back, and choosing a level again is what makes a Schedule.
  it("keeps an owner who chose no check without one", async () => {
    const w = world({ mode: "on" });
    await w.checks.ensure();
    await w.checks.report(["bot: shared sign-in"]);
    await w.checks.stop();
    expect(w.deleteSchedule).toHaveBeenCalledWith("schedule-1");
    expect(await w.checks.level()).toBeNull();
    expect(await w.checks.current()).toBeNull();
    await w.checks.ensure();
    expect(w.createRRule).toHaveBeenCalledTimes(1);
    await w.checks.enable("standard");
    expect(w.createRRule).toHaveBeenCalledTimes(2);
    expect(await w.checks.level()).toBe("standard");
  });

  // TEST_SCENARIO: the owner deleted the Schedule with the controls every Schedule has, so no check runs and the level says so.
  it("has no level once the owner deleted the schedule", async () => {
    const w = world();
    await w.checks.enable("deep");
    w.schedules.delete("schedule-1");
    expect(await w.checks.level()).toBeNull();
  });

  // TEST_SCENARIO: a release before the level let every check ask Agents, and its record names no level. The refresh gives that Schedule the task that asks none, since its owner never chose the top level.
  it("stops a check from before the choice asking agents", async () => {
    const w = world();
    await w.checks.enable();
    const row = w.repo.row();
    const schedule = w.schedules.get("schedule-1");
    if (row === null || schedule?.spec.type !== "rrule")
      throw new Error("no schedule made");
    await w.repo.save(OWNER, KIND, { ...row, level: null });
    w.schedules.set(schedule.id, {
      ...schedule,
      spec: { ...schedule.spec, task: securityCheckSchedule.task("deep") },
    });
    await w.checks.refresh();
    expect(taskOf(w)).toBe(securityCheckSchedule.task("standard"));
    expect(taskOf(w)).not.toContain(ASKS_AGENTS);
  });

  // TEST_SCENARIO: the owner chose the top level, so a refresh after a release keeps the task that asks Agents.
  it("keeps the top level across a release", async () => {
    const w = world();
    await w.checks.enable("deep");
    const schedule = w.schedules.get("schedule-1");
    if (schedule?.spec.type !== "rrule") throw new Error("no schedule made");
    w.schedules.set(schedule.id, {
      ...schedule,
      spec: { ...schedule.spec, task: "the procedure of an earlier release" },
    });
    await w.checks.refresh();
    expect(taskOf(w)).toBe(securityCheckSchedule.task("deep"));
  });
});

describe("another kind of assistant schedule", () => {
  // TEST_SCENARIO: a second default Schedule shares the store with the security check; each kind keeps its own Schedule and its own alert, so turning one off leaves the other as it was.
  it("keeps its own schedule and alert beside the security check", async () => {
    const w = world();
    const digest = w.scheduleFor({
      ...securityCheckSchedule,
      kind: "digest",
      name: "Weekly digest",
    });
    await w.checks.enable();
    await digest.enable();
    await w.checks.report(["bot: shared sign-in"]);
    await digest.report(["3 runs failed"]);
    expect(w.repo.row()?.items).toEqual(["bot: shared sign-in"]);
    expect(w.repo.row("digest")?.items).toEqual(["3 runs failed"]);
    await digest.disable();
    expect(w.repo.row("digest")).toBeNull();
    expect(w.repo.row()?.scheduleId).toBe("schedule-1");
  });
});

describe("turning the security check off", () => {
  // TEST_SCENARIO: switching off takes away what the switch gave: the Schedule and the record with its last report, so no alert is left behind.
  it("deletes the schedule and the last report", async () => {
    const w = world();
    await w.checks.enable();
    await w.checks.report(["bot: shared sign-in"]);
    await w.checks.disable();
    expect(w.deleteSchedule).toHaveBeenCalledWith("schedule-1");
    expect(w.repo.row()).toBeNull();
    expect(await w.checks.current()).toBeNull();
  });

  // TEST_SCENARIO: the install pins the feature on, so a flag written off takes nothing away: the owner's Schedule and its edits stay.
  it("takes nothing away where the install pins the feature on", async () => {
    const w = world({ mode: "on" });
    await w.checks.ensure();
    await w.checks.disable();
    expect(w.deleteSchedule).not.toHaveBeenCalled();
    expect(w.repo.row()?.scheduleId).toBe("schedule-1");
  });
});

describe("the assistant's report", () => {
  // TEST_SCENARIO: a report replaces the one before it and is what the owner is shown, with the Agent and the Schedule the alert needs to find the check's Session.
  it("keeps the last report and shows it", async () => {
    const w = world();
    await w.checks.enable();
    await w.checks.report(["old"]);
    const reported = await w.checks.report([
      "bot: shared sign-in",
      "ci: full access",
    ]);
    const expected = {
      agentId: "agent-ada",
      scheduleId: "schedule-1",
      items: ["bot: shared sign-in", "ci: full access"],
      reportedAt: NOW.toISOString(),
    };
    expect(reported).toEqual(expected);
    expect(await w.checks.current()).toEqual(expected);
  });

  // TEST_SCENARIO: after a fix the assistant says what is left of the same check. The report keeps its time, which names the alert, so an alert the owner dismissed stays dismissed; a new check gets a new time and is told again.
  it("keeps the report's time on an update, and moves it on a new check", async () => {
    const w = world();
    await w.checks.enable();
    await w.checks.report(["bot: shared sign-in", "ci: full access"]);
    w.state.now = LATER;
    const updated = await w.checks.report(["ci: full access"], {
      update: true,
    });
    expect(updated).toMatchObject({
      items: ["ci: full access"],
      reportedAt: NOW.toISOString(),
    });
    expect(await w.checks.report(["ci: full access"])).toMatchObject({
      reportedAt: LATER.toISOString(),
    });
  });

  // TEST_SCENARIO: a report with no problem says the setup is fine, so it is recorded and the earlier alert goes.
  it("clears the alert when a check finds nothing", async () => {
    const w = world();
    await w.checks.enable();
    await w.checks.report(["bot: shared sign-in"]);
    expect(await w.checks.report([])).toMatchObject({ items: [] });
    expect(await w.checks.current()).toBeNull();
  });

  // TEST_SCENARIO: a person who never turned the check on has no record, so a report an agent sends anyway is answered with nothing recorded and no alert appears.
  it("records nothing for a person without a check", async () => {
    const w = world();
    expect(await w.checks.report(["x"])).toBeNull();
    expect(await w.checks.current()).toBeNull();
  });

  // TEST_SCENARIO: the feature is off for this person, so a report is not kept and an earlier one is not shown.
  it("keeps and shows nothing while the feature is off", async () => {
    const off = world({ enabled: false });
    await off.checks.enable();
    expect(await off.checks.report(["x"])).toBeNull();
    expect(await off.checks.current()).toBeNull();
  });

  // TEST_SCENARIO: the owner deleted the check's Schedule, so no run will ever clear the last report; the alert goes with the Schedule.
  it("shows nothing once the owner deleted the schedule", async () => {
    const w = world();
    await w.checks.enable();
    await w.checks.report(["bot: shared sign-in"]);
    w.schedules.clear();
    expect(await w.checks.current()).toBeNull();
  });

  // TEST_SCENARIO: the owner no longer has the Agent the report is about, so there is no chat to open and the alert is not shown.
  it("shows nothing for an agent the owner no longer has", async () => {
    const w = world({ owned: false });
    await w.checks.enable();
    await w.checks.report(["bot: shared sign-in"]);
    expect(await w.checks.current()).toBeNull();
  });
});
