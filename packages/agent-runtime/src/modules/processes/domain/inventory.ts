import type { FinishedRow, KeepSource, ProcessRow } from "agent-runtime-api";
import {
  commandLabel,
  type ProcessTree,
  type ReportedTask,
} from "./classify.js";
import type { KeepMark, KeepOverride, KeepResolution } from "./keep.js";
import { CLK_TCK, procKey, type ScannedProcess } from "./snapshot.js";

export const FINISHED_KEEP_COUNT = 20;
export const FINISHED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export interface TrackedRow {
  identity: string;
  key: string;
  kind: "harness-task" | "detached";
  procKey: string | null;
  command: string;
  startedAt: string;
  outputPath: string | null;
  keepsAwake: boolean;
  keepSource: KeepSource;
}

export interface ProcessesDocument {
  bootId: string;
  lastScanAt: string | null;
  lastRunning: TrackedRow[];
  finished: FinishedRow[];
  marks: KeepMark[];
  overrides: KeepOverride[];
}

export interface CpuSample {
  at: number;
  ticks: ReadonlyMap<string, number>;
}

export interface Inventory {
  running: ProcessRow[];
  tracked: TrackedRow[];
  finished: FinishedRow[];
  exitedTasks: ReportedTask[];
}

function cpuPercent(
  members: ScannedProcess[],
  baseline: CpuSample | null,
  scannedAt: number,
): number | null {
  if (baseline === null || members.length === 0) return null;
  const elapsedMs = scannedAt - baseline.at;
  if (elapsedMs <= 0) return null;
  let ticks = 0;
  for (const m of members) {
    const before = baseline.ticks.get(procKey(m));
    if (before !== undefined) ticks += Math.max(0, m.cpuTicks - before);
    else if (m.startedAtMs >= baseline.at) ticks += m.cpuTicks;
  }
  const percent = (ticks / CLK_TCK / (elapsedMs / 1000)) * 100;
  return Math.round(percent * 10) / 10;
}

export function finishedFrom(
  row: TrackedRow,
  finishedAt: string,
  endedBy: FinishedRow["endedBy"],
): FinishedRow {
  return {
    key: row.key,
    kind: row.kind,
    command: row.command,
    startedAt: row.startedAt,
    finishedAt,
    endedBy,
    outputPath: row.outputPath,
    keptAwake: row.keepsAwake,
    keepSource: row.keepSource,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Turns one classified scan into the rows the
 * Processes panel shows, and diffs it against the Harness Tasks and Detached
 * Processes the previous scan tracked. A tracked row missing from this scan
 * finished: it ended by exit. A Harness Task whose matched process is gone
 * also finished, even while the harness still reports it, because the harness
 * reports only at the end of a turn. It is held back as exited until the report
 * drops it, so a later match cannot list it twice. Turn Processes keep no
 * history. CPU is the tick delta of the whole tree against a baseline sample.
 */
export function assembleInventory(input: {
  trees: ProcessTree[];
  scannedAt: number;
  baseline: CpuSample | null;
  previous: TrackedRow[];
  resolveKeep: (tree: ProcessTree) => KeepResolution;
}): Inventory {
  const previousByIdentity = new Map(
    input.previous.map((row) => [row.identity, row]),
  );
  const now = new Date(input.scannedAt).toISOString();
  const running: ProcessRow[] = [];
  const tracked: TrackedRow[] = [];
  const finished: FinishedRow[] = [];
  const exitedTasks: ReportedTask[] = [];
  const seen = new Set<string>();

  for (const tree of input.trees) {
    const before = previousByIdentity.get(tree.identity);
    const rootKey = tree.root ? procKey(tree.root) : null;
    if (
      tree.kind === "harness-task" &&
      before?.procKey != null &&
      before.procKey !== rootKey
    ) {
      finished.push(finishedFrom(before, now, "exit"));
      if (tree.task) exitedTasks.push(tree.task);
      seen.add(tree.identity);
      continue;
    }
    seen.add(tree.identity);
    const startedAt = tree.root
      ? new Date(tree.root.startedAtMs).toISOString()
      : (before?.startedAt ?? now);
    const command =
      tree.task?.command ??
      tree.task?.description ??
      (tree.shown ? commandLabel(tree.shown.cmdline) : "");
    const { keepsAwake, keepSource } = input.resolveKeep(tree);
    const row: ProcessRow = {
      key: tree.key,
      kind: tree.kind,
      pid: tree.root?.pid ?? null,
      command,
      startedAt,
      cpuPercent: cpuPercent(tree.members, input.baseline, input.scannedAt),
      rssBytes: tree.root
        ? tree.members.reduce((sum, m) => sum + m.rssBytes, 0)
        : null,
      outputPath: tree.shown?.outputPath ?? tree.root?.outputPath ?? null,
      keepsAwake,
      keepSource,
    };
    running.push(row);
    if (tree.kind === "turn") continue;
    tracked.push({
      identity: tree.identity,
      key: row.key,
      kind: tree.kind,
      procKey: rootKey,
      command: row.command,
      startedAt: row.startedAt,
      outputPath: row.outputPath,
      keepsAwake: row.keepsAwake,
      keepSource: row.keepSource,
    });
  }

  for (const row of input.previous) {
    if (!seen.has(row.identity)) finished.push(finishedFrom(row, now, "exit"));
  }

  return { running, tracked, finished, exitedTasks };
}

export function trimFinished(
  finished: FinishedRow[],
  nowMs: number,
): FinishedRow[] {
  const cutoff = nowMs - FINISHED_KEEP_MS;
  return finished
    .filter((row) => Date.parse(row.finishedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
    .slice(0, FINISHED_KEEP_COUNT);
}

export function startNewBoot(
  doc: ProcessesDocument,
  bootId: string,
  nowMs: number,
): ProcessesDocument {
  if (bootId === "" || doc.bootId === bootId) return doc;
  const finishedAt = doc.lastScanAt ?? new Date(nowMs).toISOString();
  const hibernated =
    doc.bootId === ""
      ? []
      : doc.lastRunning.map((row) =>
          finishedFrom(row, finishedAt, "hibernation"),
        );
  return {
    bootId,
    lastScanAt: null,
    lastRunning: [],
    finished: trimFinished([...hibernated, ...doc.finished], nowMs),
    marks: [],
    overrides: [],
  };
}

export function trackedSignature(rows: TrackedRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.identity}=${row.key}:${row.outputPath}:${row.keepsAwake}:${row.keepSource}`,
    )
    .sort()
    .join("\n");
}

export function noticeSignature(running: ProcessRow[]): string {
  return running
    .map((row) => `${row.key}:${row.keepsAwake ? 1 : 0}:${row.keepSource}`)
    .sort()
    .join("\n");
}
