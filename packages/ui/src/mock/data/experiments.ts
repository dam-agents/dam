import { AGENT_IDS } from "./agents.js";

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

export const experiments = [
  {
    id: "exp-001",
    name: "spring-palette-warm-vs-cool",
    driverAgentId: AGENT_IDS.agent5,
    status: "running",
    createdAt: hoursAgo(1),
  },
  {
    id: "exp-002",
    name: "spring-palette-warm-vs-cool",
    driverAgentId: AGENT_IDS.agent5,
    status: "completed",
    createdAt: hoursAgo(3),
  },
  {
    id: "exp-005",
    name: "spring-palette-warm-vs-cool",
    driverAgentId: AGENT_IDS.agent5,
    status: "failed",
    createdAt: hoursAgo(2),
  },
  {
    id: "exp-003",
    name: "serif-vs-sans-hero-text",
    driverAgentId: AGENT_IDS.agent6,
    status: "completed",
    createdAt: hoursAgo(4),
  },
  {
    id: "exp-004",
    name: "serif-vs-sans-hero-text",
    driverAgentId: AGENT_IDS.agent6,
    status: "completed",
    createdAt: hoursAgo(6),
  },
];

export const driverSummaries = [
  {
    driverAgentId: AGENT_IDS.agent5,
    experiments: [
      {
        id: "exp-001",
        name: "spring-palette-warm-vs-cool",
        status: "running",
        createdAt: hoursAgo(1),
      },
      {
        id: "exp-002",
        name: "spring-palette-warm-vs-cool",
        status: "completed",
        createdAt: hoursAgo(3),
      },
      {
        id: "exp-005",
        name: "spring-palette-warm-vs-cool",
        status: "failed",
        createdAt: hoursAgo(2),
      },
    ],
    runningInvocations: 3,
  },
  {
    driverAgentId: AGENT_IDS.agent6,
    experiments: [
      {
        id: "exp-003",
        name: "serif-vs-sans-hero-text",
        status: "completed",
        createdAt: hoursAgo(4),
      },
      {
        id: "exp-004",
        name: "serif-vs-sans-hero-text",
        status: "completed",
        createdAt: hoursAgo(6),
      },
    ],
    runningInvocations: 0,
  },
];
