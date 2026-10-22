import { AGENT_IDS } from "./agents.js";

export interface MockBackgroundTask {
  id: string;
  command: string;
  startedAt: string;
  processKey: string;
}

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

export const mockBackgroundTasks: MockBackgroundTask[] = [
  {
    id: "bg-1",
    command: "npm run build",
    startedAt: minutesAgo(3),
    processKey: "proc-npm-build-1",
  },
  {
    id: "bg-2",
    command: "python train.py --epochs 40",
    startedAt: minutesAgo(12),
    processKey: "proc-python-train-1",
  },
];

export const mockBackgroundTasksByAgent: Record<string, MockBackgroundTask[]> =
  {
    [AGENT_IDS.codexResearch]: mockBackgroundTasks,
  };
