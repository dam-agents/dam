import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLATFORM_BASE_URL ?? "http://localhost:4444";

const storageState = "./.auth/user.json";

export default defineConfig({
  testDir: "./src/tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  // First paint after the Keycloak redirect can exceed the 5s default on a
  // cold CI cluster (bundle load + auth round-trips), which made 01-auth flaky.
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on",
    screenshot: "only-on-failure",
    video: "on",
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
      name: "injection",
      testMatch: /05-.*\.spec\.ts$/,
      dependencies: ["messages"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      // Pure-API authorization matrix — mints its own JWT via getAccessToken
      // and never touches the browser session, so no storageState. Depends on
      // auth only to gate on a healthy cluster before running.
      name: "api-keys",
      testMatch: /06-.*\.spec\.ts$/,
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
      // Creates and deletes its own session, so it leaves no residue for other
      // specs; depends on "agent" only to gate on a provisioned running agent.
      name: "session-delete",
      testMatch: /08-.*\.spec\.ts$/,
      dependencies: ["agent"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      // Pure-API spec (mints its own JWT, no browser session, so no
      // storageState); needs the agent + granted connection from "agent".
      // Listed late so its harness recycles on env changes can't interrupt
      // the message-driven suites.
      name: "user-env",
      testMatch: /09-.*\.spec\.ts$/,
      dependencies: ["agent"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Churns its own dedicated connection on the shared agent; listed last
      // so the delete/recreate can't disturb the injection/slack suites.
      name: "connection-regrant",
      testMatch: /10-.*\.spec\.ts$/,
      dependencies: ["agent"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
  ],
});
