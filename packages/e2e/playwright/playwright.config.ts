import { defineConfig, devices, type Project } from "@playwright/test";

import prScope from "./pr-scope.json" with { type: "json" };

const baseURL = process.env.PLATFORM_BASE_URL ?? "http://localhost:4444";

const storageState = "./.auth/user.json";

const full = process.env.E2E_FULL === "1";

const timeoutScale = timeoutScaleFromEnv();

function timeoutScaleFromEnv(): number {
  const raw = process.env.E2E_TIMEOUT_SCALE;
  if (raw === undefined || raw.trim() === "") return 1;
  const scale = Number(raw);
  if (!Number.isFinite(scale) || scale < 1) {
    throw new Error(
      `E2E_TIMEOUT_SCALE must be a number of at least 1, got "${raw}"`,
    );
  }
  return scale;
}

const workers = workersFromEnv();

function workersFromEnv(): number {
  const raw = process.env.E2E_WORKERS;
  if (raw === undefined || raw.trim() === "") return 2;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(
      `E2E_WORKERS must be a whole number of at least 1, got "${raw}"`,
    );
  }
  return count;
}

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
    /* UNIT_BOUNDARY_DESCRIPTION: the assistant spec signs in as accounts of its own, so it takes no stored session and no other spec's account: it runs once, before anything that shares the suite's state. */
    name: "assistant",
    testMatch: /16-.*\.spec\.ts$/,
    dependencies: ["auth"],
    workers: 1,
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
    testMatch: /\/(17|18|22|23|25|27|29)-.*\.spec\.ts$/,
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

const prKept = prKeptFromEnv();

function prKeptFromEnv(): Set<string> {
  const names = (process.env.E2E_PR_SPECS ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);
  const unknown = names.filter((name) => !(name in prScope.specs));
  if (unknown.length > 0) {
    throw new Error(
      `E2E_PR_SPECS names no spec pr-scope.json defers: ${unknown.join(", ")}`,
    );
  }
  return new Set(names);
}

const prSkipped =
  process.env.E2E_SCOPE === "pr"
    ? Object.keys(prScope.specs).filter((name) => !prKept.has(name))
    : [];

const prSkip =
  prSkipped.length > 0
    ? new RegExp(`\\/(${prSkipped.join("|")})\\.spec\\.ts$`)
    : undefined;

const agentMachineSpec = "19-agent-machine";

const prEmpty = new Set(
  prSkipped.includes(agentMachineSpec) ? ["agent-machine"] : [],
);

const agentMachine: NamedProject = {
  name: "agent-machine",
  testMatch: new RegExp(`\\/${agentMachineSpec}\\.spec\\.ts$`),
  dependencies: suite.map(({ name }) => name),
  use: { ...devices["Desktop Chrome"], storageState },
};

const runnerRelease: NamedProject = {
  name: "runner-release",
  testMatch: /28-.*\.spec\.ts$/,
  dependencies: [...suite, agentMachine]
    .map(({ name }) => name)
    .filter((name) => !prEmpty.has(name)),
  use: { ...devices["Desktop Chrome"], storageState },
};

const projects = [...suite, agentMachine, runnerRelease].filter(
  ({ name }) => !prEmpty.has(name),
);

/**
 * UNIT_BOUNDARY_DESCRIPTION: the smoke suite's Playwright projects: which specs a run
 * takes, and in what order. E2E_SCOPE=pr narrows a pull request's run to the specs
 * that fail for real there, and the merge queue, the nightly run and a tag take every
 * one (docs/architecture/e2e.md). pr-scope.json lists the specs it defers, and
 * E2E_PR_SPECS names those a pull request's change still needs, from the paths that
 * file maps to each. No spec a PR run keeps reads state an excluded spec creates. The
 * agent machine spec deletes its owner's runner, so it runs in its own project after
 * every other one, and in no other project. E2E_TIMEOUT_SCALE multiplies the default
 * test and expect timeouts: e2e:loop sets it, as a warm cluster shares the machine's
 * CPUs with the browser and an action takes seconds there, where it takes tenths in CI.
 * A spec's own timeout stays as it is.
 * E2E_WORKERS sets how many specs run at once, 2 by default: e2e:loop sets 1 in an
 * Environment, whose 4 vCPUs two workers' agent machines and browsers overrun (#6199).
 */
export default defineConfig({
  testDir: "./src/tests",
  /* UNIT_BOUNDARY_DESCRIPTION: the suite's shared account declines the assistant before any spec signs in, so no lane depends on a feature that ships on for everyone. */
  globalSetup: "./src/global-setup.ts",
  fullyParallel: false,
  workers,
  retries: 0,
  timeout: 30_000 * timeoutScale,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ...(process.env.E2E_REPORT_JSON
      ? [["json", { outputFile: process.env.E2E_REPORT_JSON }] as const]
      : []),
  ],
  expect: { timeout: 15_000 * timeoutScale },
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
  projects: projects.map((project) =>
    prSkip ? { ...project, testIgnore: prSkip } : project,
  ),
});
