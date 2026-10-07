import type { ProcessesService } from "agent-runtime-api";
import type { DocumentStoreBackend } from "../../core/document-store.js";
import type { ReportedTask } from "./domain/classify.js";
import { createOutputReader } from "./infrastructure/output-file.js";
import { createProcessTable } from "./infrastructure/proc-scan.js";
import { openProcessesDocument } from "./infrastructure/processes-document.js";
import { createProcessesService } from "./services/processes-service.js";

export interface ComposeProcessesOptions {
  stateBackend: DocumentStoreBackend;
  runtimePid: number;
  harnessPid: () => number | null;
  activeTurnSince: () => number | null;
  reportedTasks: () => ReportedTask[];
  onTasksChanged: (cb: () => void) => void;
  log: (msg: string) => void;
}

export function composeProcesses(opts: ComposeProcessesOptions): {
  service: ProcessesService;
} {
  return {
    service: createProcessesService({
      table: createProcessTable(),
      document: openProcessesDocument(opts.stateBackend),
      outputs: createOutputReader(),
      runtimePid: opts.runtimePid,
      harnessPid: opts.harnessPid,
      activeTurnSince: opts.activeTurnSince,
      reportedTasks: opts.reportedTasks,
      onTasksChanged: opts.onTasksChanged,
      log: opts.log,
    }),
  };
}
