import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLATFORM_BASE_URL ?? "http://localhost:4444";

const storageState = "./.auth/user.json";

const full = process.env.E2E_FULL === "1";

export default defineConfig({
  testDir: "./src/tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
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
  projects: [
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
      name: "agent",
      testMatch: /03-.*\.spec\.ts$/,
      dependencies: ["connection"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      name: "messages",
      testMatch: /04-.*\.spec\.ts$/,
      dependencies: ["agent"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      name: "experiments",
      testMatch: /12-.*\.spec\.ts$/,
      dependencies: ["messages"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      name: "injection",
      testMatch: /05-.*\.spec\.ts$/,
      dependencies: ["experiments"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      name: "api-keys",
      testMatch: /06-.*\.spec\.ts$/,
      dependencies: ["auth"],
      use: { ...devices["Desktop Chrome"] },
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
      name: "kb-share",
      testMatch: /17-.*\.spec\.ts$/,
      dependencies: ["auth"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "slack",
      testMatch: /07-.*\.spec\.ts$/,
      dependencies: ["injection"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      name: "slack-shared",
      testMatch: /08-slack-shared\.spec\.ts$/,
      dependencies: ["slack"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "slack-inchat",
      testMatch: /09-slack-inchat-bind\.spec\.ts$/,
      dependencies: ["slack-shared"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "slack-ambient",
      testMatch: /10-slack-ambient\.spec\.ts$/,
      dependencies: ["slack-inchat"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "session-delete",
      testMatch: /08-session-delete\.spec\.ts$/,
      dependencies: ["agent"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      name: "user-env",
      testMatch: /09-user-env\.spec\.ts$/,
      dependencies: ["agent"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "egress-path-rules",
      testMatch: /11-.*\.spec\.ts$/,
      dependencies: ["slack-ambient"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      name: "connection-regrant",
      testMatch: /10-connection-regrant\.spec\.ts$/,
      dependencies: ["egress-path-rules"],
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
            testMatch: /full\/slack-.*\.spec\.ts$/,
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
        ]
      : []),
  ],
});
