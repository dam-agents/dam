import { AGENT_IDS } from "./agents.js";

export const experiments = [
  {
    id: "exp-001",
    name: "prompt-temperature-sweep",
    driverAgentId: AGENT_IDS.experiment1,
    status: "running",
    createdAt: "2024-03-15T10:00:00.000Z",
  },
  {
    id: "exp-002",
    name: "prompt-temperature-sweep",
    driverAgentId: AGENT_IDS.experiment1,
    status: "completed",
    createdAt: "2024-03-14T08:00:00.000Z",
  },
  {
    id: "exp-003",
    name: "rag-chunking-256-vs-512",
    driverAgentId: AGENT_IDS.experiment2,
    status: "completed",
    createdAt: "2024-03-12T14:00:00.000Z",
  },
  {
    id: "exp-004",
    name: "rag-chunking-256-vs-512",
    driverAgentId: AGENT_IDS.experiment2,
    status: "completed",
    createdAt: "2024-03-11T09:30:00.000Z",
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
        createdAt: "2024-03-15T10:00:00.000Z",
      },
      {
        id: "exp-002",
        name: "prompt-temperature-sweep",
        status: "completed",
        createdAt: "2024-03-14T08:00:00.000Z",
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
        createdAt: "2024-03-12T14:00:00.000Z",
      },
      {
        id: "exp-004",
        name: "rag-chunking-256-vs-512",
        status: "completed",
        createdAt: "2024-03-11T09:30:00.000Z",
      },
    ],
    runningInvocations: 0,
  },
];
