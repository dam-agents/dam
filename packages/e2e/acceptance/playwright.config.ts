import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

import { accountSlots } from "./src/config.js";
import type { Surface } from "./src/fixtures.js";

const examples = defineBddConfig({
  features: "features/**/*.feature",
  steps: ["src/steps/**/*.ts", "src/fixtures.ts"],
  outputDir: ".features-gen",
});

const chrome = {
  ...devices["Desktop Chrome"],
  launchOptions: {
    args: [
      "--host-resolver-rules=MAP *.localhost 127.0.0.1, MAP localhost 127.0.0.1",
    ],
  },
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the acceptance suite's Playwright projects. Every example of the feature files runs through the API (`examples-api`); an example tagged `@ui` also runs through the web UI (`examples-ui`), as a test of its own; the journeys run in the browser. Workers match the account slots the install provisions, so each worker signs in as accounts nothing else uses. Traces and screenshots of failed tests, and each example's evidence, are the log bundle a failure leaves in the report.
 */
export default defineConfig<{ surface: Surface }>({
  workers: accountSlots,
  fullyParallel: true,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ...(process.env.E2E_ACCEPTANCE_REPORT_JSON
      ? [
          [
            "json",
            { outputFile: process.env.E2E_ACCEPTANCE_REPORT_JSON },
          ] as const,
        ]
      : []),
  ],
  use: {
    baseURL: process.env.PLATFORM_BASE_URL ?? "http://localhost:4444",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...chrome,
  },
  projects: [
    {
      name: "examples-api",
      testDir: examples,
      use: { surface: "api" },
    },
    {
      name: "examples-ui",
      testDir: examples,
      grep: /@ui/,
      use: { surface: "ui" },
    },
    {
      name: "journeys",
      testDir: "src/journeys",
    },
  ],
});
