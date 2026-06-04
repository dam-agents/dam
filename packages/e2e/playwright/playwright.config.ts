import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLATFORM_BASE_URL ?? "http://localhost:4444";

const storageState = "./.auth/user.json";

export default defineConfig({
  testDir: "./src/tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
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
  ],
});
