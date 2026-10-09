import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { createBackgroundWorkRegistry } from "../../modules/acp/services/background-work-registry.js";
import type { ScannedProcess } from "../../modules/processes/domain/snapshot.js";
import { openProcessesDocument } from "../../modules/processes/infrastructure/processes-document.js";
import { createKeepState } from "../../modules/processes/services/keep-state.js";
import { createProcessesService } from "../../modules/processes/services/processes-service.js";

const RUNTIME = 8;
const HARNESS = 1176;
const OLDER_THAN_FRESH_MS = 10_000;

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

const build = [
  proc(
    1495,
    HARNESS,
    "bash -c eval 'npm run build'",
    "/tmp/s1/tasks/t1.output",
  ),
  proc(1496, 1495, "npm run build", "/tmp/s1/tasks/t1.output"),
];

let home: string | undefined;

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
  home = undefined;
});

function setup() {
  home = mkdtempSync(join(tmpdir(), "exited-harness-task-"));
  const document = openProcessesDocument(createFileDocumentStoreBackend(home));
  const keep = createKeepState(document);
  const registry = createBackgroundWorkRegistry({
    isKept: (sessionId, item) => keep.isKeptTask(sessionId, item.id),
  });
  let processes = [...platform, ...build];

  const service = createProcessesService({
    table: {
      scan: () =>
        Promise.resolve({
          scannedAt: Date.now() - OLDER_THAN_FRESH_MS,
          processes,
        }),
      bootId: () => Promise.resolve("boot-1"),
    },
    document,
    outputs: { tail: () => Promise.resolve(null) },
    signals: { send: () => undefined },
    keep,
    backgroundWorkHolds: true,
    runtimePid: RUNTIME,
    harnesses: () => [{ pid: HARNESS, turnSince: null }],
    reportedTasks: () =>
      registry.reported().flatMap(({ sessionId, items }) =>
        items.map((item) => ({
          sessionId,
          taskId: item.id,
          command: item.command,
          description: item.description,
        })),
      ),
    onTasksChanged: (cb) => registry.onChange(cb),
    onTaskKeepChanged: () => registry.keepChanged(),
    dropTask: (sessionId, taskId) => registry.drop(sessionId, taskId),
    pendingRestart: () => null,
    applyPendingRestart: () => false,
    onPendingRestartChange: () => undefined,
    log: () => undefined,
  });

  return {
    service,
    registry,
    buildExits() {
      processes = [...platform];
    },
  };
}

describe("a Harness Task that exits between turns", () => {
  it("stops holding the agent once a scan sees it gone", async () => {
    const { service, registry, buildExits } = setup();
    registry.report("s1", [{ id: "t1", command: "npm run build" }]);
    await vi.waitFor(async () => {
      const { running } = await service.list();
      expect(running.map((row) => row.kind)).toEqual(["harness-task"]);
    });

    buildExits();

    await vi.waitFor(async () => {
      const { running, finished } = await service.list();
      expect(running).toEqual([]);
      expect(finished.map((row) => row.endedBy)).toEqual(["exit"]);
      expect(registry.held()).toEqual([]);
    });
  });

  it("is not held again by a later report that still lists it", async () => {
    const { service, registry, buildExits } = setup();
    registry.report("s1", [{ id: "t1", command: "npm run build" }]);
    await vi.waitFor(async () => {
      expect((await service.list()).running).toHaveLength(1);
    });
    buildExits();
    await vi.waitFor(async () => {
      await service.list();
      expect(registry.held()).toEqual([]);
    });

    registry.report("s1", [{ id: "t1", command: "npm run build" }]);

    expect(registry.held()).toEqual([]);
  });
});
