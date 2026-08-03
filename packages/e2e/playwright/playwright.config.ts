import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLATFORM_BASE_URL ?? "http://localhost:4444";

const storageState = "./.auth/user.json";

// Two suite tiers:
// - smoke (src/tests/smoke/): the always-on pipeline — CI and plain
//   `mise run e2e` / e2e:loop run exactly these.
// - full (= smoke + src/tests/full/): on demand via
//   `mise run e2e:loop -- --full`. src/tests/full/ holds the slow,
//   scenario-heavy specs only the full suite runs; their projects enter the
//   list behind this env gate. Conventions: one "<area>-full" project per
//   area, specs self-contained (own agents, own token via getAccessToken +
//   acceptTerms — the terms gate 412s everything else on a fresh DB — no
//   storageState, no dependency on the smoke chain's fixtures), and each
//   spec references its motivating ticket in the test title.
const full = process.env.E2E_FULL === "1";

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
      // Experiments rail (#2942): runs the real python SDK inside the mock
      // pod. Chat-driving like "messages", so it sits right after it — well
      // before the tail specs that roll or wedge the shared agent's gateway.
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
      // Pure-API shared-mode coverage (no storageState); runs after "slack",
      // and each Slack spec below establishes the bindings it needs.
      name: "slack-shared",
      testMatch: /08-slack-shared\.spec\.ts$/,
      dependencies: ["slack"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // In-chat bind/unbind slash commands (pure API, no storageState); runs
      // after "slack-shared" and releases every binding when it finishes.
      name: "slack-inchat",
      testMatch: /09-slack-inchat-bind\.spec\.ts$/,
      dependencies: ["slack-shared"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Ambient mode on a binding (pure API, no storageState); runs after
      // "slack-inchat", releasing prior bindings before establishing its own.
      name: "slack-ambient",
      testMatch: /10-slack-ambient\.spec\.ts$/,
      dependencies: ["slack-inchat"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Creates and deletes its own session, so it leaves no residue for other
      // specs; depends on "agent" only to gate on a provisioned running agent.
      name: "session-delete",
      testMatch: /08-session-delete\.spec\.ts$/,
      dependencies: ["agent"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      // Pure-API spec (mints its own JWT, no browser session, so no
      // storageState); needs the agent + granted connection from "agent".
      // Listed late so its harness recycles on env changes can't interrupt
      // the message-driven suites.
      name: "user-env",
      // Exact match — a numeral-prefix glob would also capture the Slack
      // specs sharing the prefix and run them twice, outside their chain.
      testMatch: /09-user-env\.spec\.ts$/,
      dependencies: ["agent"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Rolls the shared agent's gateway (path rules force a MITM chain), so
      // it runs after every spec that drives the agent's chat/egress flows —
      // "slack-ambient" is the tail of the Slack chain, so depending on it
      // (not just "slack") keeps this and connection-regrant behind ALL
      // agent-driving specs; scheduling by dependency depth alone ran the
      // gateway-wedging regrant before the ambient spec.
      name: "egress-path-rules",
      testMatch: /11-.*\.spec\.ts$/,
      dependencies: ["slack-ambient"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      // Deleting + recreating a connection can wedge the gateway rollout on
      // the deleted Secret (stuck ContainerCreating; the StatefulSet's
      // maxUnavailable needs an alpha feature gate to evict it). Nothing here
      // needs the agent Ready afterwards, so this runs last.
      name: "connection-regrant",
      // Exact match — the numeral-prefix glob would also capture the ambient
      // Slack spec sharing the prefix and run it twice, outside its chain.
      testMatch: /10-connection-regrant\.spec\.ts$/,
      dependencies: ["egress-path-rules"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    ...(full
      ? [
          {
            // Invocation lifecycles: spawn + gateway-level egress assertions,
            // several agent boots per spec — minutes each, hence full-only.
            name: "invocations-full",
            testMatch: /full\/invocation-.*\.spec\.ts$/,
            use: { ...devices["Desktop Chrome"] },
          },
          {
            // Several Slack bindings on one agent (#3086): two agent turns
            // plus rebinding, minutes long — hence full-only.
            name: "slack-full",
            testMatch: /full\/slack-.*\.spec\.ts$/,
            use: { ...devices["Desktop Chrome"] },
          },
          {
            // Gateway rollout recovery (#2817): waits out a wedge and a heal,
            // and parks the controller cluster-wide — must never overlap.
            name: "gateway-full",
            testMatch: /full\/gateway-.*\.spec\.ts$/,
            use: { ...devices["Desktop Chrome"] },
          },
          {
            // Cron firing (#435): waits up to a minute for a `* * * * *`
            // schedule to fire on its own — hence full-only.
            name: "schedules-full",
            testMatch: /full\/schedule-.*\.spec\.ts$/,
            use: { ...devices["Desktop Chrome"] },
          },
          {
            // Prompt delivery feedback (#829): three of the four specs wait
            // out the UI's 60s delivery deadline on purpose, so this is the
            // slowest project in the suite (~5 minutes) and never belongs in
            // the always-on smoke tier. Each spec drives the shared mock agent
            // through the chat UI and restores its default script afterwards,
            // so they are safe in any order but must not overlap — `workers:
            // 1` above already guarantees that.
            name: "prompt-delivery-full",
            testMatch: /full\/prompt-delivery-.*\.spec\.ts$/,
            use: { ...devices["Desktop Chrome"] },
          },
        ]
      : []),
  ],
});
