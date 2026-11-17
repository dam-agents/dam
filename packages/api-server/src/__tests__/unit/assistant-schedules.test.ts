// TEST_OVERVIEW: a Schedule the platform gives one owner's assistant, shown on the security check, its first kind. Turning it on gives their assistant one weekly Schedule and records it; a person with no assistant is refused; a Schedule that still stands is left alone and a deleted one is made again only by the switch. Turning it off deletes the Schedule and the last report. The assistant's report replaces the one before it, is kept only for a person the feature is on for, and is shown only while it names a problem on an Agent the owner still has.
import type { Schedule, SchedulesService } from "api-server-api";
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

function memoryRepo(): AssistantSchedulesRepository & {
  row: (kind?: string) => AssistantScheduleRow | null;
} {
  const stored = new Map<string, AssistantScheduleRow>();
  return {
    row: (kind = KIND) => stored.get(kind) ?? null,
    find: async (_owner, kind) => stored.get(kind) ?? null,
    save: async (_owner, kind, schedule) => {
      stored.set(kind, { ...schedule, items: [], reportedAt: null });
    },
    report: async (_owner, kind, items, at) => {
      const row = stored.get(kind);
      if (row === undefined) return null;
      const next = { ...row, items: [...items], reportedAt: at };
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
  } = {},
) {
  const schedules = new Map<string, Schedule>();
  let made = 0;
  const createRRule = vi.fn(
    async (input: Parameters<SchedulesService["createRRule"]>[0]) => {
      made += 1;
      const schedule = {
        id: `schedule-${String(made)}`,
        name: input.name,
        agentId: input.agentId,
      } as Schedule;
      schedules.set(schedule.id, schedule);
      return schedule;
    },
  );
  const deleteSchedule = vi.fn(async (id: string) => {
    schedules.delete(id);
  });
  const repo = memoryRepo();
  const checks = createAssistantSchedule({
    definition: securityCheckSchedule,
    owner: OWNER,
    repo,
    assistantName: "Ada",
    enabled: async () => opts.enabled ?? true,
    assistantAgentId: async () =>
      opts.assistant === undefined ? "agent-ada" : opts.assistant,
    ownsAgent: async () => opts.owned ?? true,
    schedules: {
      get: async (id) => schedules.get(id) ?? null,
      createRRule,
      delete: deleteSchedule,
    },
    now: () => NOW,
  });
  return { checks, repo, schedules, createRRule, deleteSchedule };
}

describe("turning the security check on", () => {
  // TEST_SCENARIO: the switch gives the assistant one weekly Schedule in a fresh Session each time, at the owner's own minute of the week, and the record names it.
  it("gives the assistant a weekly schedule and records it", async () => {
    const w = world();
    await w.checks.enable();
    expect(w.createRRule).toHaveBeenCalledTimes(1);
    expect(w.createRRule.mock.calls[0]?.[0]).toMatchObject({
      name: "Security check",
      agentId: "agent-ada",
      rrule: securityCheckSchedule.rule(OWNER),
      timezone: "UTC",
      sessionMode: "fresh",
      sessionTitle: "Security check",
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

  // TEST_SCENARIO: an install that pins the feature on gives each person the Schedule once; one they deleted stays deleted, since no switch asked for it again.
  it("gives the schedule once where there is no switch", async () => {
    const w = world();
    await w.checks.ensure();
    w.schedules.clear();
    await w.checks.ensure();
    expect(w.createRRule).toHaveBeenCalledTimes(1);
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

describe("another kind of assistant schedule", () => {
  // TEST_SCENARIO: a second default Schedule shares the store with the security check; each kind keeps its own Schedule and its own alert, so turning one off leaves the other as it was.
  it("keeps its own schedule and alert beside the security check", async () => {
    const w = world();
    const digest = createAssistantSchedule({
      definition: {
        ...securityCheckSchedule,
        kind: "digest",
        name: "Weekly digest",
      },
      owner: OWNER,
      repo: w.repo,
      assistantName: "Ada",
      enabled: async () => true,
      assistantAgentId: async () => "agent-ada",
      ownsAgent: async () => true,
      schedules: {
        get: async (id) => w.schedules.get(id) ?? null,
        createRRule: w.createRRule,
        delete: w.deleteSchedule,
      },
      now: () => NOW,
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
    const on = world();
    await on.checks.enable();
    const off = world({ enabled: false });
    expect(await off.checks.report(["x"])).toBeNull();
    expect(await off.checks.current()).toBeNull();
  });

  // TEST_SCENARIO: the owner no longer has the Agent the report is about, so there is no chat to open and the alert is not shown.
  it("shows nothing for an agent the owner no longer has", async () => {
    const w = world({ owned: false });
    await w.checks.enable();
    await w.checks.report(["bot: shared sign-in"]);
    expect(await w.checks.current()).toBeNull();
  });
});
