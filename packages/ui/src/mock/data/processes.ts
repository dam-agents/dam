import type { FinishedRow, ProcessList, ProcessRow } from "agent-runtime-api";

import { AGENT_IDS } from "./agents.js";

// TODO(dev): processes API needs the starting session
type MockProcessRow = ProcessRow & { sessionId?: string };
type MockFinishedRow = FinishedRow & { sessionId?: string };

const now = new Date();
const minutesAgo = (m: number) =>
  new Date(now.getTime() - m * 60_000).toISOString();

const npmBuild: MockProcessRow = {
  key: "proc-npm-build-1",
  kind: "harness-task",
  pid: 48201,
  command: "npm run build",
  startedAt: minutesAgo(12),
  cpuPercent: 22,
  rssBytes: 140 * 1024 * 1024,
  outputPath: "/tmp/agent-output/npm-build.log",
  keepsAwake: false,
  keepSource: "default",
  sessionId: "Fix login redirect",
};

const pythonTrain: MockProcessRow = {
  key: "proc-python-train-1",
  kind: "detached",
  pid: 48300,
  command: "python train.py --epochs 40",
  startedAt: minutesAgo(42),
  cpuPercent: 95,
  rssBytes: 3200 * 1024 * 1024,
  outputPath: "/tmp/agent-output/train.log",
  keepsAwake: true,
  keepSource: "agent",
  sessionId: "Nightly eval",
};

const hibernatedJob: MockFinishedRow = {
  key: "proc-cargo-hib-1",
  kind: "detached",
  command: "cargo test --release",
  startedAt: minutesAgo(30),
  finishedAt: minutesAgo(5),
  endedBy: "hibernation",
  outputPath: "/tmp/agent-output/cargo-test.log",
  keptAwake: false,
  keepSource: "default",
  sessionId: "Fix login redirect",
};

export const processList: ProcessList = {
  running: [npmBuild, pythonTrain],
  finished: [hibernatedJob],
  pendingRestart: null,
};

export const processListEmpty: ProcessList = {
  running: [],
  finished: [],
  pendingRestart: null,
};

export const processListByAgent: Record<string, ProcessList> = {
  [AGENT_IDS.codexResearch]: processList,
};

export const processOutput: Record<
  string,
  { text: string; truncated: boolean }
> = {
  "proc-npm-build-1": {
    text: `> myapp@2.1.0 build
> tsc && vite build

vite v5.4.2 building for production...
transforming...
✓ 214 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html          0.46 kB │ gzip:  0.30 kB
dist/assets/vendor.js  142.08 kB │ gzip: 46.12 kB
dist/assets/index.js   186.34 kB │ gzip: 58.91 kB
dist/assets/index.css   24.18 kB │ gzip:  5.44 kB
✓ built in 4.82s`,
    truncated: false,
  },
  "proc-python-train-1": {
    text: `[2026-10-14 06:18:02] Starting training run
[2026-10-14 06:18:03] Model: gpt2-medium, Dataset: openwebtext
[2026-10-14 06:18:04] Epochs: 40, Batch size: 32, LR: 3e-4
[2026-10-14 06:18:10] Epoch  1/40 ▏ loss=4.821 lr=3.0e-04 ▏ 42s
[2026-10-14 06:18:52] Epoch  2/40 ▏ loss=4.317 lr=3.0e-04 ▏ 42s
[2026-10-14 06:19:34] Epoch  3/40 ▏ loss=3.982 lr=2.9e-04 ▏ 42s
[2026-10-14 06:20:16] Epoch  4/40 ▏ loss=3.714 lr=2.8e-04 ▏ 42s
[2026-10-14 06:20:58] Epoch  5/40 ▏ loss=3.501 lr=2.7e-04 ▏ 42s
[2026-10-14 06:21:40] Epoch  6/40 ▏ loss=3.328 lr=2.5e-04 ▏ 42s
[2026-10-14 06:22:22] Epoch  7/40 ▏ loss=3.184 lr=2.4e-04 ▏ 42s
[2026-10-14 06:23:04] Epoch  8/40 ▏ loss=3.062 lr=2.2e-04 ▏ 42s
[2026-10-14 06:23:46] Epoch  9/40 ▏ loss=2.958 lr=2.1e-04 ▏ 42s
[2026-10-14 06:24:28] Epoch 10/40 ▏ loss=2.871 lr=1.9e-04 ▏ 42s
[2026-10-14 06:25:10] Epoch 11/40 ▏ loss=2.795 lr=1.8e-04 ▏ 42s
[2026-10-14 06:25:52] Epoch 12/40 ▏ loss=2.731 lr=1.6e-04 ▏ 42s
[2026-10-14 06:26:34] Epoch 13/40 ▏ loss=2.674 lr=1.5e-04 ▏ 42s
[2026-10-14 06:27:16] Epoch 14/40 ▏ loss=2.625 lr=1.3e-04 ▏ 42s
[2026-10-14 06:27:58] Epoch 15/40 ▏ loss=2.582 lr=1.2e-04 ▏ 42s
[2026-10-14 06:28:40] Epoch 16/40 ▏ loss=2.544 lr=1.1e-04 ▏ 42s
[2026-10-14 06:29:22] Epoch 17/40 ▏ loss=2.510 lr=9.0e-05 ▏ 42s
[2026-10-14 06:30:02] Epoch 18/40 ▏ loss=2.480 lr=7.5e-05 ▏ running...`,
    truncated: false,
  },
  "proc-cargo-hib-1": {
    text: `   Compiling myapp v0.1.0 (/workspace)
    Finished \`release\` profile target(s) in 12.34s
     Running unittests src/main.rs

running 24 tests
test auth::test_verify_token ... ok
test auth::test_expired_token ... ok
test routes::test_health ... ok

[agent hibernated — output stopped]`,
    truncated: false,
  },
};
