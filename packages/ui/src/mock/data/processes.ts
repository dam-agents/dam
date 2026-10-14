import type { FinishedRow, ProcessList, ProcessRow } from "agent-runtime-api";

const now = new Date();
const minutesAgo = (m: number) =>
  new Date(now.getTime() - m * 60_000).toISOString();

const pytestRun: ProcessRow = {
  key: "proc-pytest-1",
  kind: "turn",
  pid: 48201,
  command: "pytest tests/ -x --tb=short",
  startedAt: minutesAgo(2),
  cpuPercent: 34,
  rssBytes: 180 * 1024 * 1024,
  outputPath: "/tmp/agent-output/pytest-1.log",
  keepsAwake: false,
  keepSource: "default",
};

const harnessKeepAwake: ProcessRow = {
  key: "proc-harness-keep-1",
  kind: "harness-task",
  pid: 48300,
  command: "node dist/scheduled-check.js --interval 300",
  startedAt: minutesAgo(12),
  cpuPercent: 1.2,
  rssBytes: 64 * 1024 * 1024,
  outputPath: "/tmp/agent-output/scheduled-check.log",
  keepsAwake: true,
  keepSource: "agent",
};

const detachedHibernation: ProcessRow = {
  key: "proc-detached-hib-1",
  kind: "detached",
  pid: 48450,
  command: "tail -f /var/log/app/events.log",
  startedAt: minutesAgo(25),
  cpuPercent: 0,
  rssBytes: 8 * 1024 * 1024,
  outputPath: "/tmp/agent-output/tail-events.log",
  keepsAwake: false,
  keepSource: "default",
};

const finishedSuccess: FinishedRow = {
  key: "proc-finished-ok-1",
  kind: "harness-task",
  command: "npm run build",
  startedAt: minutesAgo(45),
  finishedAt: minutesAgo(38),
  endedBy: "exit",
  outputPath: "/tmp/agent-output/build.log",
  keptAwake: false,
  keepSource: "default",
};

const finishedFailed: FinishedRow = {
  key: "proc-finished-fail-1",
  kind: "detached",
  command: "cargo test --release",
  startedAt: minutesAgo(60),
  finishedAt: minutesAgo(52),
  endedBy: "hibernation",
  outputPath: "/tmp/agent-output/cargo-test.log",
  keptAwake: true,
  keepSource: "user",
};

export const processList: ProcessList = {
  running: [pytestRun, harnessKeepAwake, detachedHibernation],
  finished: [finishedSuccess, finishedFailed],
  pendingRestart: {
    reason: "config-recycle",
    since: minutesAgo(1),
    blockingTasks: 1,
    stops: { tasks: 1, turns: 0 },
  },
};

export const processListEmpty: ProcessList = {
  running: [],
  finished: [],
  pendingRestart: null,
};

export const processOutput: Record<
  string,
  { text: string; truncated: boolean }
> = {
  "proc-pytest-1": {
    text: `============================= test session starts ==============================
platform linux -- Python 3.12.4, pytest-8.3.2
rootdir: /workspace
collected 47 items

tests/test_auth.py::test_login PASSED                                    [  2%]
tests/test_auth.py::test_refresh_token PASSED                            [  4%]
tests/test_auth.py::test_logout PASSED                                   [  6%]
tests/test_middleware.py::test_rate_limit PASSED                          [  8%]
tests/test_middleware.py::test_cors_headers PASSED                        [ 10%]
tests/test_routes.py::test_health_endpoint PASSED                        [ 12%]
tests/test_routes.py::test_user_create PASSED                            [ 14%]
tests/test_routes.py::test_user_get PASSED                               [ 17%]
tests/test_routes.py::test_user_update PASSED                            [ 19%]
tests/test_routes.py::test_user_delete PASSED                            [ 21%]

 21/47 passed, running...`,
    truncated: false,
  },
  "proc-harness-keep-1": {
    text: `[2026-10-13T08:01:00Z] Scheduled check started
[2026-10-13T08:01:01Z] Fetching upstream events...
[2026-10-13T08:01:02Z] 3 new events found
[2026-10-13T08:06:00Z] Scheduled check started
[2026-10-13T08:06:01Z] Fetching upstream events...
[2026-10-13T08:06:02Z] 0 new events found
[2026-10-13T08:11:00Z] Scheduled check started
[2026-10-13T08:11:01Z] Fetching upstream events...
[2026-10-13T08:11:03Z] 1 new event found`,
    truncated: false,
  },
  "proc-detached-hib-1": {
    text: `Oct 13 07:48:12 app[web.1]: Request processed in 42ms
Oct 13 07:48:15 app[web.1]: Request processed in 38ms
Oct 13 07:49:01 app[worker.1]: Job completed: email_digest
Oct 13 07:50:22 app[web.1]: Request processed in 55ms`,
    truncated: false,
  },
  "proc-finished-ok-1": {
    text: `> myapp@1.0.0 build
> tsc && vite build

vite v5.4.2 building for production...
✓ 342 modules transformed.
dist/index.html          0.46 kB │ gzip: 0.30 kB
dist/assets/index.js   284.12 kB │ gzip: 89.34 kB
✓ built in 3.21s`,
    truncated: false,
  },
  "proc-finished-fail-1": {
    text: `   Compiling myapp v0.1.0 (/workspace)
    Finished \`release\` profile target(s) in 12.34s
     Running unittests src/main.rs

running 24 tests
test auth::test_verify_token ... ok
test auth::test_expired_token ... ok
test routes::test_health ... ok
test routes::test_not_found ... FAILED
test db::test_connection_pool ... FAILED

failures:
---- routes::test_not_found stdout ----
thread 'routes::test_not_found' panicked at 'assertion failed: expected 404, got 500'

test result: FAILED. 22 passed; 2 failed; 0 ignored`,
    truncated: false,
  },
};
