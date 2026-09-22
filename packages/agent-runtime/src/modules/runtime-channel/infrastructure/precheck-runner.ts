import {
  mergedSpawnEnv,
  type RuntimeEnvReader,
} from "../../../core/runtime-env.js";
import { runOnce } from "../../../core/run-once.js";
import { verdictFor, type PrecheckOutcome } from "../domain/precheck.js";

const PRECHECK_TIMEOUT_MS = 2 * 60 * 1000;

export interface PrecheckRequest {
  command: string;
  scheduleId: string;
  fireAt?: string;
  lastRunAt?: string;
}

export type PrecheckRunner = (
  request: PrecheckRequest,
) => Promise<PrecheckOutcome>;

export function createPrecheckRunner(deps: {
  workDir: string;
  envReader: RuntimeEnvReader;
}): PrecheckRunner {
  return async (request) =>
    verdictFor(
      await runOnce({
        command: ["bash", "-lc", request.command],
        cwd: deps.workDir,
        timeoutMs: PRECHECK_TIMEOUT_MS,
        env: {
          ...mergedSpawnEnv(deps.envReader),
          PLATFORM_SCHEDULE_ID: request.scheduleId,
          ...(request.fireAt ? { PLATFORM_FIRE_AT: request.fireAt } : {}),
          PLATFORM_LAST_RUN_AT: request.lastRunAt ?? "",
        },
      }),
    );
}
