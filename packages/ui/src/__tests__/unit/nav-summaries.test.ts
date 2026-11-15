// TEST_OVERVIEW: the two agent-navigation summaries whose count contradicted the agent. Skills counts the ones in effect, the source skills switched on plus the agent's own; schedules counts every schedule the page lists, paused ones included, and leaves out the past one-time tasks it folds away.
import { describe, expect, it } from "vitest";

import {
  schedulesNavSummary,
  skillsNavSummary,
} from "../../modules/sandboxes/lib/nav-summaries.js";
import type { Schedule } from "../../types.js";

const base: Schedule = {
  id: "s",
  name: "s",
  agentId: "agent-1",
  type: "rrule",
  cron: null,
  rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  timezone: "UTC",
  quietHours: [],
  task: "Triage the new issues",
  precheck: null,
  enabled: true,
  createdBy: "user",
  status: null,
  at: null,
  inSession: null,
  harness: null,
  model: null,
  settings: null,
  profile: null,
  migrationNote: null,
  sessionTitle: null,
};

const skill = (name: string) => ({ name });

describe("skillsNavSummary", () => {
  // TEST_SCENARIO: a starter-kit agent carries its skills as the agent's own rather than from a source, and the page lists them, so the navigation must not say none are enabled.
  it("counts the skills the agent carries of its own", () => {
    expect(
      skillsNavSummary(
        { installed: [], standalone: [skill("a"), skill("b")] },
        0,
      ),
    ).toBe("2 skills");
  });

  // TEST_SCENARIO: a source-installed skill and one the agent carries are both on the page, so one count carries both, and the sources follow the same summary.
  it("adds source skills, the agent's own and the sources it reads", () => {
    expect(
      skillsNavSummary(
        { installed: [skill("a")], standalone: [skill("b")] },
        2,
      ),
    ).toBe("2 skills · 2 sources");
  });

  // TEST_SCENARIO: an agent the user turned every skill off on still reads a source; it has to say so rather than look empty.
  it("says none enabled while a source is connected", () => {
    expect(skillsNavSummary({ installed: [], standalone: [] }, 1)).toBe(
      "None enabled · 1 source",
    );
  });

  // TEST_SCENARIO: an agent with no skill and no source has nothing to report.
  it("says none yet with neither", () => {
    expect(skillsNavSummary({ installed: [], standalone: [] }, 0)).toBe(
      "None yet",
    );
  });
});

describe("schedulesNavSummary", () => {
  // TEST_SCENARIO: a kit creates its schedule paused, so it is not upcoming; the page lists it and the navigation must count it.
  it("counts a paused schedule the page lists", () => {
    expect(schedulesNavSummary([{ ...base, enabled: false }])).toBe(
      "1 schedule",
    );
  });

  // TEST_SCENARIO: a one-time task whose run has passed sits in the page's folded group, so it does not inflate the count.
  it("leaves out a past one-time task", () => {
    expect(
      schedulesNavSummary([
        base,
        {
          ...base,
          id: "once",
          type: "once",
          status: { lastRun: "2026-11-01T00:00:00Z", lastResult: "success" },
        },
      ]),
    ).toBe("1 schedule");
  });

  // TEST_SCENARIO: an agent with no schedule says so.
  it("says no schedules when the page lists none", () => {
    expect(schedulesNavSummary([])).toBe("No schedules");
  });
});
