export type ProcessKind = "turn" | "harness-task" | "detached" | "startup-item";

export type EndedBy = "exit" | "stop" | "hibernation";

export type KeepSource = "default" | "user" | "agent";

export type ContainerEngine = "docker" | "k3s" | "containerd";

export interface ProcessContainer {
  engine: ContainerEngine;
  role: "container" | "runtime";
  id: string;
}

export interface ProcessRow {
  key: string;
  kind: ProcessKind;
  pid?: number;
  command: string;
  startedAt: string;
  cpuPercent?: number;
  rssBytes?: number;
  outputPath: string | null;
  keepsAwake: boolean;
  keepSource: KeepSource;
  container?: ProcessContainer;
}

export interface FinishedRow {
  key: string;
  kind?: ProcessKind;
  command: string;
  startedAt?: string;
  finishedAt: string;
  endedBy: EndedBy;
  outputPath: string | null;
  keptAwake?: boolean;
  keepSource?: KeepSource;
  container?: ProcessContainer;
}

export interface StartupItem {
  id: string;
  command: string;
  running: boolean;
  disabled: boolean;
  listed: boolean;
  outputPath: string | null;
}

export interface PendingRestart {
  blockingTasks: number;
  stops: { tasks: number; turns: number };
}

export interface ProcessList {
  running: ProcessRow[];
  finished: FinishedRow[];
  startupItems?: StartupItem[];
  pendingRestart: PendingRestart | null;
}

export const PROCESS_OUTPUT_MAX_BYTES = 256 * 1024;
