import type { ProcessKind } from "agent-runtime-api";
import type { ReportedTask, RunningHarness } from "../../acp/index.js";
import { procKey, type ProcSnapshot, type ScannedProcess } from "./snapshot.js";

export interface ClassifyInput {
  snapshot: ProcSnapshot;
  runtimePid: number;
  harnesses: RunningHarness[];
  tasks: ReportedTask[];
}

export interface ProcessTree {
  identity: string;
  key: string;
  kind: ProcessKind;
  root: ScannedProcess | null;
  shown: ScannedProcess | null;
  members: ScannedProcess[];
  task: ReportedTask | null;
}

export function taskIdentity(
  task: Pick<ReportedTask, "sessionId" | "taskId">,
): string {
  return `task:${task.sessionId}:${task.taskId}`;
}

function normalizeCommand(text: string): string {
  return text
    .replaceAll(`'"'"'`, "'")
    .replaceAll(`'\\''`, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const SHELL_EVAL = /\beval '((?:[^']|'"'"'|'\\'')*)'/;
const COMMAND_LABEL_MAX = 500;

function isShellWrapper(cmdline: string): boolean {
  return SHELL_EVAL.test(cmdline);
}

export function commandLabel(cmdline: string): string {
  const evaluated = SHELL_EVAL.exec(cmdline)?.[1];
  const label = evaluated === undefined ? cmdline : normalizeCommand(evaluated);
  return label.slice(0, COMMAND_LABEL_MAX);
}

function runtimeAncestors(
  byPid: ReadonlyMap<number, ScannedProcess>,
  runtimePid: number,
): Set<number> {
  const ancestors = new Set<number>([1]);
  for (
    let pid = byPid.get(runtimePid)?.ppid;
    pid !== undefined && pid > 0 && !ancestors.has(pid);
    pid = byPid.get(pid)?.ppid
  ) {
    ancestors.add(pid);
  }
  return ancestors;
}

export function platformOwnPids(
  processes: ScannedProcess[],
  runtimePid: number,
): Set<number> {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const own = runtimeAncestors(byPid, runtimePid);
  own.add(runtimePid);
  for (const p of processes) if (p.ppid === runtimePid) own.add(p.pid);
  return own;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Sorts the pod's process table into the three
 * kinds the Processes panel lists, one tree per root. The platform's own
 * processes are never listed: PID 1, agent-runtime and its ancestors, and
 * agent-runtime's direct children (the chat harnesses, the pod service, PTYs,
 * sshd). There is one chat harness per lease, and each is read the same way.
 * A Harness Task is a chat-harness descendant matched to a task a harness
 * reported, by the output file the harness names after the task id. Never by
 * command: two tasks can run the same command, and a guess could hand one task
 * the other's process. A Turn Process is a chat-harness descendant outside
 * every Harness Task tree, started at or after the earliest turn running on
 * that harness, so helpers the harness started before the turn (MCP servers
 * and the like) stay out, and so do children of older work that writes to a file,
 * which is unreported background work rather than the turn's. A Detached
 * Process is a child of the reaper an orphan is re-parented to: PID 1, or an ancestor of
 * agent-runtime acting as subreaper (catatonit when it is not PID 1). When
 * its root is only a forked copy of a tool shell, the row shows the command
 * below it. Work under an attached PTY or SSH shell is not listed until it
 * detaches.
 */
export function classifyProcesses(input: ClassifyInput): ProcessTree[] {
  const { processes } = input.snapshot;
  const byPid = new Map<number, ScannedProcess>();
  const children = new Map<number, ScannedProcess[]>();
  for (const p of processes) {
    byPid.set(p.pid, p);
    const siblings = children.get(p.ppid) ?? [];
    siblings.push(p);
    children.set(p.ppid, siblings);
  }

  const descendantsOf = (root: ScannedProcess): ScannedProcess[] => {
    const out: ScannedProcess[] = [];
    const stack = [...(children.get(root.pid) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      out.push(next);
      stack.push(...(children.get(next.pid) ?? []));
    }
    return out;
  };

  const ancestors = runtimeAncestors(byPid, input.runtimePid);

  const harnessPids = new Set(input.harnesses.map((h) => h.pid));
  const harnessTrees = input.harnesses.flatMap((h) => {
    const root = byPid.get(h.pid);
    return root
      ? [{ descendants: descendantsOf(root), turnSince: h.turnSince }]
      : [];
  });
  const harnessDescendants = harnessTrees.flatMap((t) => t.descendants);

  const topmost = (matches: ScannedProcess[]): ScannedProcess[] => {
    const pids = new Set(matches.map((p) => p.pid));
    return matches.filter((p) => {
      for (
        let pid = p.ppid;
        pid > 0 && byPid.has(pid);
        pid = byPid.get(pid)!.ppid
      ) {
        if (pids.has(pid)) return false;
        if (harnessPids.has(pid)) break;
      }
      return true;
    });
  };

  const taskRoot = (task: ReportedTask): ScannedProcess | null => {
    const outputName = `/${task.taskId}.output`;
    const tops = topmost(
      harnessDescendants.filter((p) => p.outputPath?.endsWith(outputName)),
    );
    return tops.length === 1 ? tops[0]! : null;
  };

  const claimed = new Set<string>();
  const unclaimed = (p: ScannedProcess) => !claimed.has(procKey(p));
  const trees: ProcessTree[] = [];

  for (const task of input.tasks) {
    const identity = taskIdentity(task);
    const root = taskRoot(task);
    const members = root ? [root, ...descendantsOf(root)] : [];
    for (const m of members) claimed.add(procKey(m));
    trees.push({
      identity,
      key: root ? procKey(root) : identity,
      kind: "harness-task",
      root,
      shown: root,
      members,
      task,
    });
  }

  for (const { descendants, turnSince } of harnessTrees) {
    if (turnSince === null) continue;
    const candidates = descendants.filter(
      (p) => unclaimed(p) && p.startedAtMs >= turnSince,
    );
    const candidatePids = new Set(candidates.map((p) => p.pid));
    for (const root of candidates) {
      if (candidatePids.has(root.ppid)) continue;
      if (byPid.get(root.ppid)?.outputPath != null) continue;
      const members = [root, ...descendantsOf(root)].filter(unclaimed);
      const key = procKey(root);
      trees.push({
        identity: key,
        key,
        kind: "turn",
        root,
        shown: root,
        members,
        task: null,
      });
    }
  }

  for (const root of processes) {
    if (!ancestors.has(root.ppid)) continue;
    if (ancestors.has(root.pid) || root.pid === input.runtimePid) continue;
    const members = [root, ...descendantsOf(root)];
    let shown = root;
    for (
      let only = children.get(shown.pid);
      isShellWrapper(shown.cmdline) && only?.length === 1;
      only = children.get(shown.pid)
    ) {
      shown = only[0]!;
    }
    const key = procKey(root);
    trees.push({
      identity: key,
      key,
      kind: "detached",
      root,
      shown,
      members,
      task: null,
    });
  }

  return trees;
}
