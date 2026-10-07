import type { PendingRestart, ProcessesService } from "agent-runtime-api";
import type { DocumentStoreBackend } from "../../core/document-store.js";
import type { ReportedTask } from "./domain/classify.js";
import { createOutputReader } from "./infrastructure/output-file.js";
import { createProcessTable } from "./infrastructure/proc-scan.js";
import { openProcessesDocument } from "./infrastructure/processes-document.js";
import { createProcessSignals } from "./infrastructure/signals.js";
import { createKeepState, type KeptProcesses } from "./services/keep-state.js";
import {
  createProcessesService,
  type KeepMarkSink,
} from "./services/processes-service.js";

export interface StartProcessesOptions {
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

export interface PreparedProcesses {
  isKeptTask: (sessionId: string, taskId: string) => boolean;
  keptProcesses: KeptProcesses;
  start(opts: StartProcessesOptions): {
    service: ProcessesService;
    keepMarks: KeepMarkSink;
  };
}

export function prepareProcesses(
  stateBackend: DocumentStoreBackend,
): PreparedProcesses {
  const document = openProcessesDocument(stateBackend);
  const keep = createKeepState(document);
  return {
    isKeptTask: keep.isKeptTask,
    keptProcesses: keep.keptProcesses,
    start(opts) {
      const service = createProcessesService({
        ...opts,
        table: createProcessTable(),
        document,
        outputs: createOutputReader(),
        signals: createProcessSignals(),
        keep,
      });
      return { service, keepMarks: service };
    },
  };
}
