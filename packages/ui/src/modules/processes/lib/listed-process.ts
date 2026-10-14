import type { ProcessList } from "agent-runtime-api";

import { ENDED_BY_LABEL } from "./process-copy.js";

export interface ListedProcess {
  command: string;
  outputPath: string | null;
  status: string;
  running: boolean;
}

export function findListedProcess(
  list: ProcessList | undefined,
  key: string,
): ListedProcess | null {
  const running = list?.running.find((row) => row.key === key);
  if (running)
    return {
      command: running.command,
      outputPath: running.outputPath,
      status: "Running",
      running: true,
    };
  const finished = list?.finished.find((row) => row.key === key);
  if (finished)
    return {
      command: finished.command,
      outputPath: finished.outputPath,
      status: ENDED_BY_LABEL[finished.endedBy],
      running: false,
    };
  return null;
}
