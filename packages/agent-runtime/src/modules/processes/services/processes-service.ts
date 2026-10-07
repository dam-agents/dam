import {
  err,
  ok,
  PROCESS_OUTPUT_MAX_BYTES,
  type ProcessesService,
  type ProcessNotice,
  type ProcessRow,
} from "agent-runtime-api";
import type { DocumentStore } from "../../../core/document-store.js";
import { noticeStream } from "../../../core/notice-stream.js";
import {
  classifyProcesses,
  taskIdentity,
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
import { procKey, type ProcSnapshot } from "../domain/snapshot.js";
import type { OutputReader } from "../infrastructure/output-file.js";
import type { ProcessTable } from "../infrastructure/proc-scan.js";

const FRESH_MS = 3_000;
const WATCHED_SCAN_MS = 3_000;
const BACKGROUND_SCAN_MS = 30_000;
const LAST_SCAN_PERSIST_MS = 5 * 60_000;
const CPU_BASELINE_MIN_MS = 1_000;
const CPU_SAMPLES_KEPT = 5;
const NOTICE_COALESCE_MS = 250;
const NOTICE: ProcessNotice = { topic: "processes" };

export interface ProcessesServiceDeps {
  table: ProcessTable;
  document: DocumentStore<ProcessesDocument>;
  outputs: OutputReader;
  runtimePid: number;
  harnessPid: () => number | null;
  activeTurnSince: () => number | null;
  reportedTasks: () => ReportedTask[];
  onTasksChanged: (cb: () => void) => void;
  log: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The process inventory behind the Processes
 * panel. It scans the process table every few seconds while someone watches,
 * every half minute otherwise, on demand when a read finds the last scan
 * stale, and whenever the harness reports a change to its Harness Tasks. Each
 * scan is diffed with the last: Harness Tasks and Detached Processes that are
 * gone move to the finished history in the processes runtime document. The
 * document carries the boot id. On a new boot, the rows the last scan saw
 * running are recorded as ended by hibernation, since nothing outlives one.
 * Watchers get a data-less notice when a row appears, goes, or changes
 * whether it keeps the agent awake; CPU and memory changes are polled.
 */
export function createProcessesService(
  deps: ProcessesServiceDeps,
): ProcessesService {
  let latest: { snapshot: ProcSnapshot; running: ProcessRow[] } | null = null;
  let samples: CpuSample[] = [];
  let exitedTasks = new Set<string>();
  let tracked: TrackedRow[] = [];
  let inflight: Promise<void> | null = null;
  let rescan = false;
  let lastSignature = "";
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
    const trees = classifyProcesses({
      snapshot,
      runtimePid: deps.runtimePid,
      harnessPid: deps.harnessPid(),
      turnSince: deps.activeTurnSince(),
      tasks,
      taskMatches,
      skipTasks: exitedTasks,
    });
    const inventory = assembleInventory({
      trees,
      scannedAt: snapshot.scannedAt,
      baseline: baselineFor(snapshot.scannedAt),
      previous: tracked,
    });
    recordSample(snapshot);
    for (const id of inventory.exitedTasks) exitedTasks.add(id);
    latest = { snapshot, running: inventory.running };
    tracked = inventory.tracked;

    const lastScanAt = doc.lastScanAt === null ? 0 : Date.parse(doc.lastScanAt);
    const changed =
      inventory.finished.length > 0 ||
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
      });
    }

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

  async function fresh(): Promise<{ running: ProcessRow[] }> {
    if (latest === null || Date.now() - latest.snapshot.scannedAt >= FRESH_MS)
      await refresh();
    return { running: latest?.running ?? [] };
  }

  const backgroundTimer = setInterval(() => void refresh(), BACKGROUND_SCAN_MS);
  backgroundTimer.unref?.();
  deps.onTasksChanged(() => void refresh());
  void refresh();

  return {
    async list() {
      const { running } = await fresh();
      return {
        running,
        finished: deps.document.read().finished,
        pendingRestart: null,
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
  };
}
