import {
  err,
  ok,
  PROCESS_OUTPUT_MAX_BYTES,
  type FinishedRow,
  type KeepMarkRequest,
  type PendingRestart,
  type ProcessesService,
  type ProcessNotice,
  type ProcessRow,
  type Result,
} from "agent-runtime-api";
import type { DocumentStore } from "../../../core/document-store.js";
import { noticeStream } from "../../../core/notice-stream.js";
import {
  classifyProcesses,
  platformOwnPids,
  taskIdentity,
  type ProcessTree,
  type ReportedTask,
} from "../domain/classify.js";
import {
  assembleInventory,
  noticeSignature,
  startNewBoot,
  trackedSignature,
  trimFinished,
  type CpuSample,
  type ProcessesDocument,
  type TrackedRow,
} from "../domain/inventory.js";
import {
  createKeepResolver,
  liveMarks,
  liveOverrides,
  pidMarkId,
  pidMarkRefusal,
  userChoiceMessage,
  withOverride,
} from "../domain/keep.js";
import {
  procKey,
  type ProcSnapshot,
  type ScannedProcess,
} from "../domain/snapshot.js";
import type { OutputReader } from "../infrastructure/output-file.js";
import type { ProcessTable } from "../infrastructure/proc-scan.js";
import type { ProcessSignals } from "../infrastructure/signals.js";
import type { KeepState } from "./keep-state.js";

const FRESH_MS = 3_000;
const WATCHED_SCAN_MS = 3_000;
const KEPT_SCAN_MS = 15_000;
const UNKEPT_SCAN_EVERY = 2;
const LAST_SCAN_PERSIST_MS = 5 * 60_000;
const CPU_BASELINE_MIN_MS = 1_000;
const CPU_SAMPLES_KEPT = 5;
const NOTICE_COALESCE_MS = 250;
const STOP_GRACE_MS = 5_000;
const NOTICE: ProcessNotice = { topic: "processes" };

export type KeepMarkError =
  | { kind: "NotFound"; message: string }
  | { kind: "UserDecided"; message: string }
  | { kind: "NotKeepable"; message: string };

export interface KeepMarkSink {
  mark(
    request: KeepMarkRequest,
  ): Promise<Result<{ key: string }, KeepMarkError>>;
}

export interface ProcessesServiceDeps {
  table: ProcessTable;
  document: DocumentStore<ProcessesDocument>;
  outputs: OutputReader;
  signals: ProcessSignals;
  keep: KeepState;
  backgroundWorkHolds: boolean;
  runtimePid: number;
  harnessPid: () => number | null;
  activeTurnSince: () => number | null;
  reportedTasks: () => ReportedTask[];
  onTasksChanged: (cb: () => void) => void;
  onTaskKeepChanged: () => void;
  dropTask: (sessionId: string, taskId: string) => void;
  pendingRestart: () => PendingRestart | null;
  applyPendingRestart: () => boolean;
  onPendingRestartChange: (cb: () => void) => void;
  log: (msg: string) => void;
}

interface Latest {
  snapshot: ProcSnapshot;
  trees: ProcessTree[];
  running: ProcessRow[];
}

function stoppedRow(row: ProcessRow, kind: FinishedRow["kind"], at: string) {
  return {
    key: row.key,
    kind,
    command: row.command,
    startedAt: row.startedAt,
    finishedAt: at,
    endedBy: "stop" as const,
    outputPath: row.outputPath,
    keptAwake: row.keepsAwake,
    keepSource: row.keepSource,
  };
}

function withDescendants(
  roots: ScannedProcess[],
  processes: ScannedProcess[],
): ScannedProcess[] {
  const children = new Map<number, ScannedProcess[]>();
  for (const p of processes) {
    const siblings = children.get(p.ppid) ?? [];
    siblings.push(p);
    children.set(p.ppid, siblings);
  }
  const found = new Map<number, ScannedProcess>();
  const stack = [...roots];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (found.has(next.pid)) continue;
    found.set(next.pid, next);
    stack.push(...(children.get(next.pid) ?? []));
  }
  return [...found.values()];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The process inventory behind the Processes
 * panel, and the keep decisions on it. It scans the process table every few
 * seconds while someone watches, every 15 seconds while a Keep Mark or a kept
 * Detached Process is alive, every half minute otherwise, on demand when a
 * read finds the last scan stale, and whenever the harness reports a change to
 * its Harness Tasks. Each scan is diffed with the last: Harness Tasks and
 * Detached Processes that are gone move to the finished history in the
 * processes runtime document. The document carries the boot id. On a new
 * boot, the rows the last scan saw running are recorded as ended by
 * hibernation, and the marks and overrides are dropped, since nothing outlives
 * one. The agent marks work with `platform-keep`; the user overrides any
 * decision and is never overruled by a later mark. Stop ends a row's whole
 * tree: SIGTERM first, SIGKILL after a grace period to what is left, never to
 * a process or group that took over a pid of the tree meanwhile. Each scan
 * publishes how many Detached Processes keep the agent awake, which makes the
 * runtime busy. It also reports a harness restart that waits for kept
 * Harness Tasks, and applies it on request. Watchers get a data-less notice
 * when a row appears, goes, or changes whether it keeps the agent awake, and
 * when a waiting restart appears or goes; CPU and memory changes are polled.
 */
export function createProcessesService(
  deps: ProcessesServiceDeps,
): ProcessesService & KeepMarkSink {
  let latest: Latest | null = null;
  let samples: CpuSample[] = [];
  let exitedTasks = new Set<string>();
  let tracked: TrackedRow[] = [];
  const stopping = new Map<string, ReadonlySet<string>>();
  let inflight: Promise<void> | null = null;
  let rescan = false;
  let lastSignature = "";
  let keepAlive = false;
  let backgroundTicks = 0;
  const watchers = new Set<() => void>();
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let watchedTimer: ReturnType<typeof setInterval> | undefined;

  const ready = (async () => {
    const bootId = (await deps.table.bootId()) ?? "";
    const doc = deps.document.read();
    const next = startNewBoot(doc, bootId, Date.now());
    if (next !== doc) {
      if (doc.lastRunning.length > 0)
        deps.log(
          `${doc.lastRunning.length} process(es) ended by hibernation before this boot`,
        );
      deps.document.write(next);
    }
    tracked = next.lastRunning;
  })().catch((error: unknown) => {
    deps.log(`could not open the processes document: ${String(error)}`);
  });

  function notify(): void {
    if (watchers.size === 0 || noticeTimer) return;
    noticeTimer = setTimeout(() => {
      noticeTimer = undefined;
      for (const watcher of watchers) watcher();
    }, NOTICE_COALESCE_MS);
    noticeTimer.unref?.();
  }

  function baselineFor(scannedAt: number): CpuSample | null {
    for (let i = samples.length - 1; i >= 0; i--) {
      if (scannedAt - samples[i]!.at >= CPU_BASELINE_MIN_MS) return samples[i]!;
    }
    return null;
  }

  function recordSample(snapshot: ProcSnapshot): void {
    const newest = samples.at(-1);
    if (newest && snapshot.scannedAt - newest.at < CPU_BASELINE_MIN_MS) return;
    const ticks = new Map(
      snapshot.processes.map((p) => [procKey(p), p.cpuTicks]),
    );
    samples = [...samples, { at: snapshot.scannedAt, ticks }].slice(
      -CPU_SAMPLES_KEPT,
    );
  }

  function withoutStopping(
    trees: ProcessTree[],
    snapshot: ProcSnapshot,
  ): ProcessTree[] {
    if (stopping.size === 0) return trees;
    const stoppingKeys = new Set<string>();
    for (const keys of stopping.values())
      for (const key of keys) stoppingKeys.add(key);
    const visible = trees.filter(
      (tree) =>
        !stopping.has(tree.identity) &&
        !(tree.root && stoppingKeys.has(procKey(tree.root))),
    );
    const alive = new Set(snapshot.processes.map(procKey));
    const identities = new Set(trees.map((tree) => tree.identity));
    for (const [identity, keys] of stopping) {
      if (identities.has(identity)) continue;
      if ([...keys].some((key) => alive.has(key))) continue;
      stopping.delete(identity);
    }
    return visible;
  }

  async function scanOnce(): Promise<void> {
    await ready;
    const snapshot = await deps.table.scan();
    const doc = deps.document.read();
    const tasks = deps.reportedTasks();
    const reported = new Set(tasks.map(taskIdentity));
    exitedTasks = new Set([...exitedTasks].filter((id) => reported.has(id)));
    const taskMatches = new Map<string, string>();
    for (const row of tracked) {
      if (row.kind === "harness-task" && row.procKey !== null)
        taskMatches.set(row.identity, row.procKey);
    }
    const trees = withoutStopping(
      classifyProcesses({
        snapshot,
        runtimePid: deps.runtimePid,
        harnessPid: deps.harnessPid(),
        turnSince: deps.activeTurnSince(),
        tasks,
        taskMatches,
        skipTasks: exitedTasks,
      }),
      snapshot,
    );
    const marks = liveMarks(doc.marks, snapshot.processes, snapshot.scannedAt);
    const overrides = liveOverrides(
      doc.overrides,
      new Set([...trees.map((tree) => tree.identity), ...reported]),
      snapshot.scannedAt,
    );
    const inventory = assembleInventory({
      trees,
      scannedAt: snapshot.scannedAt,
      baseline: baselineFor(snapshot.scannedAt),
      previous: tracked,
      resolveKeep: createKeepResolver({
        marks,
        overrides,
        holds: deps.backgroundWorkHolds,
      }),
    });
    recordSample(snapshot);
    for (const id of inventory.exitedTasks) exitedTasks.add(id);
    latest = { snapshot, trees, running: inventory.running };
    tracked = inventory.tracked;

    const lastScanAt = doc.lastScanAt === null ? 0 : Date.parse(doc.lastScanAt);
    const changed =
      inventory.finished.length > 0 ||
      marks.length !== doc.marks.length ||
      overrides.length !== doc.overrides.length ||
      trackedSignature(inventory.tracked) !== trackedSignature(doc.lastRunning);
    const stale =
      inventory.tracked.length > 0 &&
      snapshot.scannedAt - lastScanAt >= LAST_SCAN_PERSIST_MS;
    if (changed || stale) {
      deps.document.write({
        ...doc,
        lastScanAt: new Date(snapshot.scannedAt).toISOString(),
        lastRunning: inventory.tracked,
        finished: trimFinished(
          [...inventory.finished, ...doc.finished],
          snapshot.scannedAt,
        ),
        marks,
        overrides,
      });
    }

    const keptDetached = inventory.running.filter(
      (row) => row.kind === "detached" && row.keepsAwake,
    ).length;
    keepAlive = marks.length > 0 || keptDetached > 0;
    deps.keep.setKeptProcesses(keptDetached);

    const signature = noticeSignature(inventory.running);
    if (signature !== lastSignature) {
      lastSignature = signature;
      notify();
    }
  }

  function refresh(): Promise<void> {
    if (inflight) {
      rescan = true;
      return inflight;
    }
    inflight = scanOnce()
      .catch((error: unknown) => {
        deps.log(`process scan failed: ${String(error)}`);
      })
      .finally(() => {
        inflight = null;
        if (!rescan) return;
        rescan = false;
        void refresh();
      });
    return inflight;
  }

  async function scanFromNow(): Promise<Latest | null> {
    if (inflight) await inflight;
    await refresh();
    return latest;
  }

  async function fresh(): Promise<{ running: ProcessRow[] }> {
    if (latest === null || Date.now() - latest.snapshot.scannedAt >= FRESH_MS)
      await refresh();
    return { running: latest?.running ?? [] };
  }

  async function killSurvivors(
    keys: ReadonlySet<string>,
    group: number | null,
  ): Promise<void> {
    const { processes } = await deps.table.scan();
    const leader = processes.find((p) => p.pid === group);
    const sameGroup =
      group !== null && (leader === undefined || keys.has(procKey(leader)));
    const survivors = processes.filter(
      (p) => keys.has(procKey(p)) || (sameGroup && p.pgrp === group),
    );
    const own = platformOwnPids(processes, deps.runtimePid);
    for (const p of withDescendants(survivors, processes)) {
      if (own.has(p.pid)) continue;
      deps.signals.send(p.pid, "SIGKILL");
    }
  }

  const backgroundTimer = setInterval(() => {
    backgroundTicks += 1;
    if (keepAlive || backgroundTicks % UNKEPT_SCAN_EVERY === 0) void refresh();
  }, KEPT_SCAN_MS);
  backgroundTimer.unref?.();
  deps.onTasksChanged(() => void refresh());
  deps.onPendingRestartChange(notify);
  void refresh();

  return {
    async list() {
      const { running } = await fresh();
      return {
        running,
        finished: deps.document.read().finished,
        pendingRestart: deps.pendingRestart(),
      };
    },

    watch(signal) {
      return noticeStream(
        NOTICE,
        (onChange) => {
          watchers.add(onChange);
          if (!watchedTimer) {
            watchedTimer = setInterval(() => void refresh(), WATCHED_SCAN_MS);
            watchedTimer.unref?.();
          }
          return {
            close() {
              watchers.delete(onChange);
              if (watchers.size > 0 || !watchedTimer) return;
              clearInterval(watchedTimer);
              watchedTimer = undefined;
            },
          };
        },
        signal,
      );
    },

    async output(key) {
      const { running } = await fresh();
      const path =
        running.find((row) => row.key === key)?.outputPath ??
        deps.document.read().finished.find((row) => row.key === key)
          ?.outputPath ??
        null;
      if (path === null) return err({ kind: "NotFound", key });
      const output = await deps.outputs.tail(path, PROCESS_OUTPUT_MAX_BYTES);
      return output === null ? err({ kind: "NotFound", key }) : ok(output);
    },

    async setKeep(key, keepsAwake) {
      const tree = (await scanFromNow())?.trees.find((t) => t.key === key);
      if (!tree) return err({ kind: "NotFound", key });
      if (tree.kind === "turn")
        return err({
          kind: "NotAllowed",
          message:
            "A foreground process ends with its turn and cannot keep the agent awake.",
        });
      const doc = deps.document.read();
      deps.document.write({
        ...doc,
        overrides: withOverride(doc.overrides, {
          key: tree.identity,
          keepsAwake,
          decidedAt: new Date().toISOString(),
        }),
      });
      deps.log(
        `the user set ${tree.kind} ${key} to ${keepsAwake ? "keep the agent awake" : "stop at hibernation"}`,
      );
      if (tree.kind === "harness-task") deps.onTaskKeepChanged();
      await scanFromNow();
      return ok(undefined);
    },

    async stop(key) {
      const current = await scanFromNow();
      const tree = current?.trees.find((t) => t.key === key);
      const row = current?.running.find((r) => r.key === key);
      if (!tree || !row) return err({ kind: "NotFound", key });
      if (!tree.root)
        return err({
          kind: "NotAllowed",
          message:
            "Can't find this task's process, so it can't be stopped from here.",
        });
      const keys = new Set(tree.members.map(procKey));
      const group = tree.root.pgrp === tree.root.pid ? tree.root.pid : null;
      stopping.set(tree.identity, keys);
      if (group !== null) deps.signals.send(-group, "SIGTERM");
      for (const member of tree.members)
        deps.signals.send(member.pid, "SIGTERM");
      deps.log(
        `the user stopped ${tree.kind} ${key} (${tree.members.length} process(es))`,
      );

      if (tree.kind !== "turn") {
        const now = new Date().toISOString();
        tracked = tracked.filter((t) => t.identity !== tree.identity);
        const doc = deps.document.read();
        deps.document.write({
          ...doc,
          lastRunning: doc.lastRunning.filter(
            (t) => t.identity !== tree.identity,
          ),
          finished: trimFinished(
            [stoppedRow(row, tree.kind, now), ...doc.finished],
            Date.now(),
          ),
        });
      }
      if (tree.task) deps.dropTask(tree.task.sessionId, tree.task.taskId);

      const killTimer = setTimeout(() => {
        void killSurvivors(keys, group).catch((error: unknown) => {
          deps.log(`could not finish stopping ${key}: ${String(error)}`);
        });
      }, STOP_GRACE_MS);
      killTimer.unref?.();
      await scanFromNow();
      return ok(undefined);
    },

    async applyPendingRestart() {
      if (!deps.applyPendingRestart()) return err({ kind: "NothingPending" });
      deps.log("the user applied the waiting harness restart");
      await scanFromNow();
      return ok(undefined);
    },

    async mark(request) {
      const current = await scanFromNow();
      const target = current?.snapshot.processes.find(
        (p) => p.pid === request.pid,
      );
      if (
        !current ||
        !target ||
        platformOwnPids(current.snapshot.processes, deps.runtimePid).has(
          target.pid,
        )
      )
        return err({
          kind: "NotFound",
          message: `No process ${request.pid} that the agent can keep.`,
        });
      const tree = current.trees.find((t) =>
        t.members.some((m) => m.pid === target.pid),
      );
      const doc = deps.document.read();
      const override =
        tree && doc.overrides.find((o) => o.key === tree.identity);
      if (override)
        return err({
          kind: "UserDecided",
          message: userChoiceMessage(override),
        });
      const refusal =
        request.kind === "pid"
          ? pidMarkRefusal({
              target,
              tree,
              processes: current.snapshot.processes,
              harnessPid: deps.harnessPid(),
              callerPid: request.callerPid,
            })
          : null;
      if (refusal !== null)
        return err({ kind: "NotKeepable", message: refusal });
      const id =
        request.kind === "launch"
          ? request.markId
          : pidMarkId(target.pid, target.startTicks);
      deps.document.write({
        ...doc,
        marks: [
          ...doc.marks.filter((m) => m.id !== id),
          {
            id,
            pid: target.pid,
            startTime: target.startTicks,
            createdAt: new Date().toISOString(),
          },
        ],
      });
      deps.log(`the agent kept pid ${target.pid} (${request.kind})`);
      await scanFromNow();
      return ok({
        key:
          tree?.kind === "detached" && tree.root ? tree.key : procKey(target),
      });
    },
  };
}
