import { defineConfig, devices, type Project } from "@playwright/test";

import { laneBackend } from "./src/lib/lane.js";

const baseURL = process.env.PLATFORM_BASE_URL ?? "http://localhost:4444";

const storageState = "./.auth/user.json";

const full = process.env.E2E_FULL === "1";

type NamedProject = Project & { name: string };

const suite: NamedProject[] = [
  {
    name: "auth",
    testMatch: /01-.*\.spec\.ts$/,
    use: { ...devices["Desktop Chrome"] },
  },
  {
    name: "connection",
    testMatch: /02-.*\.spec\.ts$/,
    dependencies: ["auth"],
    use: { ...devices["Desktop Chrome"], storageState },
  },
  {
    name: "trpc-ws-auth",
    testMatch: /13-.*\.spec\.ts$/,
    dependencies: ["auth"],
    use: { ...devices["Desktop Chrome"] },
  },
  {
    name: "live-events",
    testMatch: /14-.*\.spec\.ts$/,
    dependencies: ["auth"],
    use: { ...devices["Desktop Chrome"] },
  },
  {
    name: "agent",
    testMatch: /03-.*\.spec\.ts$/,
    dependencies: ["connection"],
    use: { ...devices["Desktop Chrome"], storageState },
  },
  {
    name: "api-keys",
    testMatch: /15-.*\.spec\.ts$/,
    dependencies: ["connection"],
    use: { ...devices["Desktop Chrome"] },
  },
  {
    name: "chain",
    testMatch: /\/(0[4-9]|1[0-2]|21)-.*\.spec\.ts$/,
    dependencies: ["agent"],
    workers: 1,
    use: { ...devices["Desktop Chrome"], storageState },
  },
  {
    name: "own-agents",
    testMatch:
      laneBackend === "vm"
        ? /\/(17|18|20|22)-.*\.spec\.ts$/
        : /\/(17|18|19)-.*\.spec\.ts$/,
    dependencies: ["agent"],
    workers: 1,
    use: { ...devices["Desktop Chrome"], storageState },
  },
  ...(full
    ? [
        {
          name: "invocations-full",
          testMatch: /full\/invocation-.*\.spec\.ts$/,
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "slack-full",
          testMatch: /full\/slack-(?!token-rotation).*\.spec\.ts$/,
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "slack-rotation-full",
          testMatch: /full\/slack-token-rotation\.spec\.ts$/,
          dependencies: ["chain", "slack-full"],
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "gateway-full",
          testMatch: /full\/gateway-.*\.spec\.ts$/,
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "schedules-full",
          testMatch: /full\/schedule-.*\.spec\.ts$/,
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "prompt-delivery-full",
          testMatch: /full\/prompt-delivery\/.*\.spec\.ts$/,
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "skills-full",
          testMatch: /full\/skill-.*\.spec\.ts$/,
          use: { ...devices["Desktop Chrome"] },
        },
      ]
    : []),
];

const agentBackend: NamedProject = {
  name: "agent-backend",
  testMatch: /19-.*\.spec\.ts$/,
  dependencies: suite.map(({ name }) => name),
  use: { ...devices["Desktop Chrome"], storageState },
};

export default defineConfig({
  testDir: "./src/tests",
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ...(process.env.E2E_REPORT_JSON
      ? [["json", { outputFile: process.env.E2E_REPORT_JSON }] as const]
      : []),
  ],
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on",
    screenshot: "only-on-failure",
    video: "on",
    launchOptions: {
      args: [
        "--host-resolver-rules=MAP *.localhost 127.0.0.1, MAP localhost 127.0.0.1",
      ],
    },
  },
  projects: laneBackend === "vm" ? [...suite, agentBackend] : suite,
});
