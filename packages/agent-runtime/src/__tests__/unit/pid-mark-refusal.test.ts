import { describe, it, expect } from "vitest";
import { classifyProcesses } from "../../modules/processes/domain/classify.js";
import { pidMarkRefusal } from "../../modules/processes/domain/keep.js";
import type { ScannedProcess } from "../../modules/processes/domain/snapshot.js";

const RUNTIME = 8;
const HARNESS = 1176;

function proc(pid: number, ppid: number, cmdline: string): ScannedProcess {
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
    outputPath: null,
    keepMark: null,
  };
}

const platform = [
  proc(1, 0, "catatonit"),
  proc(RUNTIME, 1, "node dist/server.js"),
  proc(1133, RUNTIME, "claude-agent-acp"),
  proc(HARNESS, 1133, "claude"),
];

function judge(
  extra: ScannedProcess[],
  targetPid: number,
  callerPid: number,
  tasks: { taskId: string; command: string }[] = [],
) {
  const processes = [...platform, ...extra];
  const trees = classifyProcesses({
    snapshot: { scannedAt: 0, processes },
    runtimePid: RUNTIME,
    harnessPid: HARNESS,
    turnSince: null,
    tasks: tasks.map((t) => ({
      sessionId: "s1",
      taskId: t.taskId,
      command: t.command,
      description: undefined,
    })),
    taskMatches: new Map(),
    skipTasks: new Set(),
  });
  const target = processes.find((p) => p.pid === targetPid)!;
  return pidMarkRefusal({
    target,
    tree: trees.find((t) => t.members.some((m) => m.pid === targetPid)),
    processes,
    harnessPid: HARNESS,
    callerPid,
  });
}

describe("pidMarkRefusal", () => {
  it("refuses a Harness Task, which is kept by default", () => {
    const refusal = judge(
      [
        proc(1237, HARNESS, "bash -c eval 'sleep 300 && echo done'"),
        proc(1238, 1237, "sleep 300"),
        proc(1300, HARNESS, "bash -c eval 'platform-keep --pid 1238'"),
      ],
      1238,
      1300,
      [{ taskId: "bwmlsb9mj", command: "sleep 300 && echo done" }],
    );

    expect(refusal).toContain("kept by default");
  });

  it("refuses an unreported background task of the harness, which never detaches", () => {
    const refusal = judge(
      [
        proc(1237, HARNESS, "bash -c eval 'sleep 300'"),
        proc(1238, 1237, "sleep 300"),
        proc(1300, HARNESS, "bash -c eval 'platform-keep --pid 1238'"),
      ],
      1238,
      1300,
    );

    expect(refusal).toContain("platform-keep -- <command>");
  });

  it("refuses the calling shell itself, which ends with the tool call", () => {
    const refusal = judge(
      [proc(1300, HARNESS, "bash -c eval 'platform-keep --pid $$'")],
      1300,
      1300,
    );

    expect(refusal).not.toBeNull();
  });

  it("accepts a job the calling shell backgrounded, which detaches when the shell exits", () => {
    const refusal = judge(
      [
        proc(
          1300,
          HARNESS,
          "bash -c eval 'nohup sleep 300 & platform-keep --pid $!'",
        ),
        proc(1301, 1300, "sleep 300"),
      ],
      1301,
      1300,
    );

    expect(refusal).toBeNull();
  });

  it("accepts a Detached Process", () => {
    const refusal = judge(
      [
        proc(1400, 1, "sleep 300"),
        proc(1300, HARNESS, "bash -c eval 'platform-keep --pid 1400'"),
      ],
      1400,
      1300,
    );

    expect(refusal).toBeNull();
  });

  it("accepts work under a terminal, which counts once it detaches", () => {
    const refusal = judge(
      [
        proc(1500, RUNTIME, "bash -l"),
        proc(1501, 1500, "sleep 300"),
        proc(1502, 1500, "platform-keep --pid 1501"),
      ],
      1501,
      1500,
    );

    expect(refusal).toBeNull();
  });
});
