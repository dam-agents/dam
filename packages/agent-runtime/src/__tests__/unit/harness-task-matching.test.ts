import { describe, it, expect } from "vitest";
import type { ReportedTask, RunningHarness } from "../../modules/acp/index.js";
import { classifyProcesses } from "../../modules/processes/domain/classify.js";
import type { ScannedProcess } from "../../modules/processes/domain/snapshot.js";

const RUNTIME = 8;
const HARNESS = 1176;
const SECOND_HARNESS = 2176;

function proc(
  pid: number,
  ppid: number,
  cmdline: string,
  outputPath: string | null = null,
): ScannedProcess {
  return {
    pid,
    ppid,
    pgrp: pid,
    sid: pid,
    startTicks: pid,
    startedAtMs: pid,
    cpuTicks: 0,
    rssBytes: 0,
    cmdline,
    outputPath,
    keepMark: null,
  };
}

const platform = [
  proc(1, 0, "catatonit"),
  proc(RUNTIME, 1, "node dist/server.js"),
  proc(1133, RUNTIME, "claude-agent-acp"),
  proc(HARNESS, 1133, "claude"),
  proc(2133, RUNTIME, "claude-agent-acp"),
  proc(SECOND_HARNESS, 2133, "claude"),
];

function task(sessionId: string, taskId: string): ReportedTask {
  return { sessionId, taskId, command: "sleep 300", description: undefined };
}

function backgroundSleep(
  pid: number,
  output: string,
  harness = HARNESS,
): ScannedProcess[] {
  return [
    proc(pid, harness, "bash -c eval 'sleep 300'", output),
    proc(pid + 1, pid, "sleep 300", output),
  ];
}

const bothHarnesses: RunningHarness[] = [
  { pid: HARNESS, turnSince: null },
  { pid: SECOND_HARNESS, turnSince: null },
];

function classify(
  tasks: ReportedTask[],
  extra: ScannedProcess[],
  harnesses = bothHarnesses,
) {
  return classifyProcesses({
    snapshot: { scannedAt: 0, processes: [...platform, ...extra] },
    runtimePid: RUNTIME,
    harnesses,
    tasks,
  });
}

function rootsOf(tasks: ReportedTask[], extra: ScannedProcess[]) {
  const trees = classify(tasks, extra);
  return (t: ReportedTask) =>
    trees.find((tree) => tree.task === t)?.root?.pid ?? null;
}

describe("Harness Task matching", () => {
  const first = task("s1", "first");
  const second = task("s2", "second");

  it("gives two tasks with the same command each their own process", () => {
    const root = rootsOf(
      [first, second],
      [
        ...backgroundSleep(1495, "/tmp/s1/tasks/first.output"),
        ...backgroundSleep(1595, "/tmp/s2/tasks/second.output"),
      ],
    );

    expect(root(first)).toBe(1495);
    expect(root(second)).toBe(1595);
  });

  it("leaves a task whose process ended without a process, even when another task runs the same command", () => {
    const root = rootsOf(
      [first, second],
      backgroundSleep(1595, "/tmp/s2/tasks/second.output"),
    );

    expect(root(first)).toBeNull();
    expect(root(second)).toBe(1595);
  });
});

describe("several chat harnesses", () => {
  it("matches a task to its process under whichever harness runs it", () => {
    const first = task("s1", "first");
    const second = task("s2", "second");
    const root = rootsOf(
      [first, second],
      [
        ...backgroundSleep(1495, "/tmp/s1/tasks/first.output"),
        ...backgroundSleep(2495, "/tmp/s2/tasks/second.output", SECOND_HARNESS),
      ],
    );

    expect(root(first)).toBe(1495);
    expect(root(second)).toBe(2495);
  });

  it("lists Turn Processes only under a harness with a running turn, from that turn's start", () => {
    const trees = classify(
      [],
      [
        proc(1300, HARNESS, "pytest"),
        proc(2200, SECOND_HARNESS, "mcp-server"),
        proc(2300, SECOND_HARNESS, "pytest"),
      ],
      [
        { pid: HARNESS, turnSince: null },
        { pid: SECOND_HARNESS, turnSince: 2250 },
      ],
    );

    expect(
      trees.filter((t) => t.kind === "turn").map((t) => t.root?.pid),
    ).toEqual([2300]);
  });
});
