import type { MockChangesData } from "../mock-changes-card.js";
import type { MockBackgroundTask } from "./mock-background-tasks.js";

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

export const TOOLS_DEMO_TASKS: MockBackgroundTask[] = [
  {
    id: "bg-demo-1",
    command: "npm run build",
    startedAt: minutesAgo(3),
    processKey: "proc-npm-build-1",
  },
  {
    id: "bg-demo-2",
    command: "npm run test -- --watch",
    startedAt: minutesAgo(8),
    processKey: "proc-python-train-1",
  },
];

export const TOOLS_DEMO_BROWSER_URL = "http://localhost:3000";

export const TOOLS_DEMO_CHANGES: MockChangesData = {
  filesChanged: 4,
  additions: 120,
  deletions: 18,
  repo: "acme/web-app",
  branch: "fix/auth-redirect",
  prNumber: 847,
  prUrl: "https://github.com/acme/web-app/pull/847",
};
