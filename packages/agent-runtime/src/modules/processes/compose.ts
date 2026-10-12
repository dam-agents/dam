import type { ProcessesService } from "agent-runtime-api";
import type { DocumentStoreBackend } from "../../core/document-store.js";
import type { HarnessWork } from "../acp/index.js";
import { createOutputReader } from "./infrastructure/output-file.js";
import { createProcessTable } from "./infrastructure/proc-scan.js";
import { openProcessesDocument } from "./infrastructure/processes-document.js";
import { createProcessSignals } from "./infrastructure/signals.js";
import { createKeepState, type KeepPolicy } from "./services/keep-state.js";
import {
  createProcessesService,
  type KeepMarkSink,
} from "./services/processes-service.js";

export interface StartProcessesOptions {
  backgroundWorkHolds: boolean;
  runtimePid: number;
  harnessWork: HarnessWork;
  log: (msg: string) => void;
}

export interface PreparedProcesses {
  keepPolicy: KeepPolicy;
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
    keepPolicy: keep,
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
