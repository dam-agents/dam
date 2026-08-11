import { AGENT_IDS } from "./agents.js";

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

export const experiments = [
  {
    id: "exp-001",
    name: "prompt-temperature-sweep",
    driverAgentId: AGENT_IDS.experiment1,
    status: "running",
    createdAt: hoursAgo(1),
  },
  {
    id: "exp-002",
    name: "prompt-temperature-sweep",
    driverAgentId: AGENT_IDS.experiment1,
    status: "completed",
    createdAt: hoursAgo(3),
  },
  {
    id: "exp-005",
    name: "prompt-temperature-sweep",
    driverAgentId: AGENT_IDS.experiment1,
    status: "failed",
    createdAt: hoursAgo(2),
  },
  {
    id: "exp-003",
    name: "rag-chunking-256-vs-512",
    driverAgentId: AGENT_IDS.experiment2,
    status: "completed",
    createdAt: hoursAgo(4),
  },
  {
    id: "exp-004",
    name: "rag-chunking-256-vs-512",
    driverAgentId: AGENT_IDS.experiment2,
    status: "completed",
    createdAt: hoursAgo(6),
  },
];

export const driverSummaries = [
  {
    driverAgentId: AGENT_IDS.experiment1,
    experiments: [
      {
        id: "exp-001",
        name: "prompt-temperature-sweep",
        status: "running",
        createdAt: hoursAgo(1),
      },
      {
        id: "exp-002",
        name: "prompt-temperature-sweep",
        status: "completed",
        createdAt: hoursAgo(3),
      },
      {
        id: "exp-005",
        name: "prompt-temperature-sweep",
        status: "failed",
        createdAt: hoursAgo(2),
      },
    ],
    runningInvocations: 3,
  },
  {
    driverAgentId: AGENT_IDS.experiment2,
    experiments: [
      {
        id: "exp-003",
        name: "rag-chunking-256-vs-512",
        status: "completed",
        createdAt: hoursAgo(4),
      },
      {
        id: "exp-004",
        name: "rag-chunking-256-vs-512",
        status: "completed",
        createdAt: hoursAgo(6),
      },
    ],
    runningInvocations: 0,
  },
];
