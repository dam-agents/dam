import { AGENT_IDS } from "./agents.js";

export const schedules = [
  {
    id: "sched-linkcheck",
    agentId: AGENT_IDS.docsReviewer,
    name: "Broken link sweep",
    type: "rrule",
    cron: null,
    rrule: "RRULE:FREQ=HOURLY;INTERVAL=2",
    timezone: "America/New_York",
    quietHours: [],
    task: null,
    enabled: true,
    sessionMode: "fresh",
    createdBy: "user",
    status: {
      lastRun: new Date(Date.now() - 6 * 60_000).toISOString(),
      nextRun: new Date(Date.now() + 114 * 60_000).toISOString(),
      lastResult: "success",
    },
  },
];
