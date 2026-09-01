import { fixtureSchedules } from "./agent-card-fixtures.js";
import { AGENT_IDS } from "./agents.js";

export const schedules = [
  {
    id: "sched-001",
    agentId: AGENT_IDS.codexResearch,
    name: "Daily brand audit",
    type: "rrule",
    cron: null,
    rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
    timezone: "America/New_York",
    quietHours: [],
    task: null,
    enabled: true,
    sessionMode: "fresh",
    createdBy: "user",
    status: {
      lastRun: new Date(Date.now() - 24 * 3600_000).toISOString(),
      nextRun: new Date(Date.now() + 3 * 3600_000).toISOString(),
      lastResult: "success",
    },
  },
  {
    id: "sched-002",
    agentId: AGENT_IDS.codexResearch,
    name: "Nightly test suite",
    type: "rrule",
    cron: null,
    rrule: "RRULE:FREQ=DAILY;BYHOUR=2;BYMINUTE=0",
    timezone: "America/New_York",
    quietHours: [],
    task: null,
    enabled: true,
    sessionMode: "fresh",
    createdBy: "user",
    status: {
      lastRun: new Date(Date.now() - 12 * 3600_000).toISOString(),
      nextRun: new Date(Date.now() + 14 * 3600_000).toISOString(),
      lastResult: "agent exceeded timeout after 45m",
    },
  },
  ...fixtureSchedules,
];
