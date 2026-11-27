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

/* UNIT_BOUNDARY_DESCRIPTION: the setup project, which makes the shared state every other project runs on: the shared account's stored login, Terms and assistant switch, the suite's connection, model provider and mock agent. No spec makes state another reads, so a spec can be deleted without breaking the ones after it. */
const setup: NamedProject = {
  name: "setup",
  testMatch: /setup\/.*\.setup\.ts$/,
  use: { ...devices["Desktop Chrome"] },
};

/* UNIT_BOUNDARY_DESCRIPTION: the smoke projects in stages: each project waits for setup and for every project of the stage before, the order the suite always ran in, so a project leaves the suite by leaving its stage, and a stage left empty is skipped. */
const smokeStages: NamedProject[][] = [
  [
    {
      name: "auth",
      testMatch: /01-.*\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "trpc-ws-auth",
      testMatch: /13-.*\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "live-events",
      testMatch: /14-.*\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      /* UNIT_BOUNDARY_DESCRIPTION: the assistant spec signs in as accounts of its own, so it takes no stored session and no other spec's account. */
      name: "assistant",
      testMatch: /16-.*\.spec\.ts$/,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  [
    {
      name: "chain",
      testMatch: /\/(0[4-9]|1[0-2]|21)-.*\.spec\.ts$/,
      workers: 1,
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      name: "own-agents",
      testMatch: /\/(22|25|27|29)-.*\.spec\.ts$/,
      workers: 1,
      use: { ...devices["Desktop Chrome"], storageState },
    },
  ],
];

const smoke: NamedProject[] = [
  setup,
  ...smokeStages
    .filter((stage) => stage.length > 0)
    .flatMap((stage, index, stages) =>
      stage.map((project) => ({
        ...project,
        dependencies: [
          "setup",
          ...(index === 0 ? [] : stages[index - 1]!.map(({ name }) => name)),
        ],
      })),
    ),
];

const suite: NamedProject[] = [
  ...smoke,
  ...(full
    ? [
        {
          name: "invocations-full",
          testMatch: /full\/invocation-.*\.spec\.ts$/,
          dependencies: ["setup"],
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "slack-full",
          testMatch: /full\/slack-(?!token-rotation).*\.spec\.ts$/,
          dependencies: ["setup"],
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "slack-rotation-full",
          testMatch: /full\/slack-token-rotation\.spec\.ts$/,
          dependencies: ["setup", "slack-full"],
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "gateway-full",
          testMatch: /full\/gateway-.*\.spec\.ts$/,
          dependencies: ["setup"],
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "schedules-full",
          testMatch: /full\/schedule-.*\.spec\.ts$/,
          dependencies: ["setup"],
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "prompt-delivery-full",
          testMatch: /full\/prompt-delivery\/.*\.spec\.ts$/,
          dependencies: ["setup"],
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "skills-full",
          testMatch: /full\/skill-.*\.spec\.ts$/,
          dependencies: ["setup"],
          use: { ...devices["Desktop Chrome"] },
        },
      ].map((project, index, fullProjects) => ({
        ...project,
        dependencies: [
          ...(project.dependencies ?? []),
          ...(index === 0
            ? smoke.map(({ name }) => name)
            : [fullProjects[index - 1]!.name]),
        ],
        workers: 1,
      }))
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
 * that fail for real there, and a push to main, the nightly run and a dispatch take
 * every one (docs/architecture/e2e.md). pr-scope.json lists the specs it defers, and
 * E2E_PR_SPECS names those a pull request's change still needs, from the paths that
 * file maps to each. No spec reads state another spec creates: the setup project makes the
 * shared account's login, Terms and assistant switch, the suite's connection, provider and
 * mock agent, and every other project starts after it, the full/ tier's too. The Terms gate
 * is proven on an account of its own that no setup accepts the Terms for (#6579). The
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
