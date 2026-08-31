import { AGENT_IDS } from "./agents.js";

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

export const experiments = [
  {
    id: "exp-001",
    name: "prompt-sweep-temperature",
    driverAgentId: AGENT_IDS.releaseNotes,
    status: "running",
    createdAt: hoursAgo(1),
  },
  {
    id: "exp-002",
    name: "prompt-sweep-temperature",
    driverAgentId: AGENT_IDS.releaseNotes,
    status: "completed",
    createdAt: hoursAgo(3),
  },
];

export const driverSummaries = [
  {
    driverAgentId: AGENT_IDS.releaseNotes,
    experiments: [
      {
        id: "exp-001",
        name: "prompt-sweep-temperature",
        status: "running",
        createdAt: hoursAgo(1),
      },
      {
        id: "exp-002",
        name: "prompt-sweep-temperature",
        status: "completed",
        createdAt: hoursAgo(3),
      },
    ],
    runningInvocations: 1,
  },
];
