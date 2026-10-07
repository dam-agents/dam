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

export function userChoiceMessage(override: KeepOverride): string {
  return override.keepsAwake
    ? "The user set this process to keep the agent awake in the Processes panel. It needs no mark."
    : "The user set this process to stop at hibernation in the Processes panel. Ask them before keeping it.";
}
