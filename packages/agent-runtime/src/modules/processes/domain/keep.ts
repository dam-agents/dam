import type { KeepSource } from "agent-runtime-api";
import type { ProcessTree } from "./classify.js";
import { procKey, type ScannedProcess } from "./snapshot.js";

export interface KeepMark {
  id: string;
  pid: number;
  startTime: number;
  createdAt: string;
}

export interface KeepOverride {
  key: string;
  keepsAwake: boolean;
  decidedAt: string;
}

export interface KeepDecisions {
  marks: KeepMark[];
  overrides: KeepOverride[];
  holds: boolean;
}

export interface KeepResolution {
  keepsAwake: boolean;
  keepSource: KeepSource;
}

export function pidMarkId(pid: number, startTime: number): string {
  return `pid:${pid}:${startTime}`;
}

function markedProcessKey(mark: KeepMark): string {
  return `${mark.pid}:${mark.startTime}`;
}

function carriesMark(
  p: ScannedProcess,
  markIds: ReadonlySet<string>,
  markedKeys: ReadonlySet<string>,
): boolean {
  return (
    (p.keepMark !== null && markIds.has(p.keepMark)) ||
    markedKeys.has(procKey(p))
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Decides whether one row keeps the agent awake,
 * and who decided. The user's override wins over the agent's Keep Mark, and
 * the mark wins over the default. By default a Harness Task keeps the agent
 * awake and a Detached Process does not. A Turn Process never does, and takes
 * no decision. A Detached Process carries the agent's mark when any process in
 * its tree carries one: the PLATFORM_KEEP value a `platform-keep` launch passed
 * down, which every descendant inherits even through nohup or setsid, or the
 * pid and start time a `platform-keep --pid` named. With background holds
 * switched off for the install, nothing keeps the agent awake, but the row
 * still says who decided.
 */
export function createKeepResolver(
  decisions: KeepDecisions,
): (tree: ProcessTree) => KeepResolution {
  const markIds = new Set(decisions.marks.map((m) => m.id));
  const markedKeys = new Set(decisions.marks.map(markedProcessKey));
  const overrides = new Map(decisions.overrides.map((o) => [o.key, o]));

  const decide = (tree: ProcessTree): KeepResolution => {
    if (tree.kind === "turn")
      return { keepsAwake: false, keepSource: "default" };
    const override = overrides.get(tree.identity);
    if (override)
      return { keepsAwake: override.keepsAwake, keepSource: "user" };
    if (tree.kind === "harness-task")
      return { keepsAwake: true, keepSource: "default" };
    if (tree.members.some((m) => carriesMark(m, markIds, markedKeys)))
      return { keepsAwake: true, keepSource: "agent" };
    return { keepsAwake: false, keepSource: "default" };
  };

  return (tree) => {
    const resolved = decide(tree);
    return decisions.holds ? resolved : { ...resolved, keepsAwake: false };
  };
}

export function liveMarks(
  marks: KeepMark[],
  processes: ScannedProcess[],
  scannedAt: number,
): KeepMark[] {
  const carried = new Set<string>();
  const running = new Set<string>();
  for (const p of processes) {
    if (p.keepMark !== null) carried.add(p.keepMark);
    running.add(procKey(p));
  }
  return marks.filter(
    (mark) =>
      Date.parse(mark.createdAt) >= scannedAt ||
      carried.has(mark.id) ||
      running.has(markedProcessKey(mark)),
  );
}

export function liveOverrides(
  overrides: KeepOverride[],
  liveIdentities: ReadonlySet<string>,
  scannedAt: number,
): KeepOverride[] {
  return overrides.filter(
    (o) => Date.parse(o.decidedAt) >= scannedAt || liveIdentities.has(o.key),
  );
}

export function withOverride(
  overrides: KeepOverride[],
  next: KeepOverride,
): KeepOverride[] {
  return [...overrides.filter((o) => o.key !== next.key), next];
}

export interface PidMarkInput {
  target: ScannedProcess;
  tree: ProcessTree | undefined;
  processes: ScannedProcess[];
  harnessPids: number[];
  callerPid: number;
}

function ancestorPids(
  target: ScannedProcess,
  processes: ScannedProcess[],
): Set<number> {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const ancestors = new Set<number>();
  for (
    let pid = target.ppid;
    pid > 0 && !ancestors.has(pid);
    pid = byPid.get(pid)?.ppid ?? 0
  ) {
    ancestors.add(pid);
  }
  return ancestors;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Decides whether `platform-keep --pid` may mark a
 * process, and says why not. A mark counts only on a Detached Process. A
 * Harness Task is kept by default, so it needs none. Other work under a
 * chat harness ends with the command that runs it, or with its session, and
 * never detaches, so a mark on it would report a keep that does nothing. The
 * one exception is a child of the shell that runs `platform-keep` itself, as
 * in `nohup job & platform-keep --pid $!`: it detaches when that shell exits.
 * Work outside the harness, such as under a terminal, is marked and counts
 * once it detaches.
 */
export function pidMarkRefusal(input: PidMarkInput): string | null {
  const { target, tree, harnessPids, callerPid } = input;
  if (tree?.kind === "harness-task")
    return `pid ${target.pid} is a background task your harness runs. It is kept by default, so it needs no mark.`;
  const ancestors = ancestorPids(target, input.processes);
  if (!harnessPids.some((pid) => ancestors.has(pid))) return null;
  if (ancestors.has(callerPid)) return null;
  return `pid ${target.pid} runs under your harness as part of another command, such as a background task or a tool call that still runs. It ends with that command or its session, so a mark cannot keep it. Start the job with platform-keep -- <command> instead.`;
}

export function userChoiceMessage(override: KeepOverride): string {
  return override.keepsAwake
    ? "The user set this process to keep the agent awake in the Processes panel. It needs no mark."
    : "The user set this process to stop at hibernation in the Processes panel. Ask them before keeping it.";
}
