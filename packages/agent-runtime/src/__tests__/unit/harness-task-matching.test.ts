import { describe, it, expect } from "vitest";
import {
  classifyProcesses,
  type ReportedTask,
} from "../../modules/processes/domain/classify.js";
import type { ScannedProcess } from "../../modules/processes/domain/snapshot.js";

const RUNTIME = 8;
const HARNESS = 1176;

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
];

function task(sessionId: string, taskId: string): ReportedTask {
  return { sessionId, taskId, command: "sleep 300", description: undefined };
}

function backgroundSleep(pid: number, output: string): ScannedProcess[] {
  return [
    proc(pid, HARNESS, "bash -c eval 'sleep 300'", output),
    proc(pid + 1, pid, "sleep 300", output),
  ];
}

function rootsOf(tasks: ReportedTask[], extra: ScannedProcess[]) {
  const trees = classifyProcesses({
    snapshot: { scannedAt: 0, processes: [...platform, ...extra] },
    runtimePid: RUNTIME,
    harnessPid: HARNESS,
    turnSince: null,
    tasks,
    skipTasks: new Set(),
  });
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
