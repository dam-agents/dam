import { AGENT_IDS } from "./agents.js";

export const schedules = [
  {
    id: "sched-001",
    agentId: AGENT_IDS.codexResearch,
    cron: "0 9 * * 1-5",
    description: "Daily morning research sync",
    enabled: true,
    lastRunAt: "2024-03-14T09:00:00.000Z",
    nextRunAt: "2024-03-15T09:00:00.000Z",
  },
];
