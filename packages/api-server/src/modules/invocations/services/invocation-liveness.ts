import type {
  InvocationRow,
  InvocationsRepository,
} from "../infrastructure/invocations-repository.js";
import type { TargetReaper } from "./target-reaper.js";
import type { RunCancel } from "./run-cancel.js";
import type { ReportedTargetReap } from "./reported-target-reap.js";
import {
  HARNESS_CONFIG_STEP,
  type ReadHarnessConfigSupport,
} from "../domain/harness-config-refusal.js";
import { harnessConfigRefusalFor } from "./harness-config-check.js";
import { createSetupFailure } from "./setup-failure.js";
import type { ScriptOutputs } from "./script-outputs.js";

const SCRIPT_STEP = "script";
const UNREAPED_AFTER_MS = 30_000;

const NO_SCRIPT_RUNNER_REASON =
  "the image's agent-runtime predates script sub-agents; rebuild the image on a current base image";

export interface InvocationLivenessSweep {
  tick(): Promise<void>;
}

export interface TargetRestartState {
  podRestarts: number;
  podRestartReason?: string;
}

export interface CreateInvocationLivenessSweepDeps {
  repo: InvocationsRepository;
  reaper: TargetReaper;
  cancel: Pick<RunCancel, "settled">;
  reportedReap: Pick<ReportedTargetReap, "due">;
  readTargetRestart: (agentId: string) => Promise<TargetRestartState | null>;
  readStartWait: (agentId: string) => Promise<string | null>;
  hasAgent: (agentId: string) => Promise<boolean>;
  readHarnessConfigSupport: ReadHarnessConfigSupport;
  runsScripts: (agentId: string) => Promise<boolean | null>;
  outputs: Pick<ScriptOutputs, "purgeExpired" | "purgeRoot">;
  batchSize: number;
  now?: () => Date;
}

export function createInvocationLivenessSweep(
  deps: CreateInvocationLivenessSweepDeps,
): InvocationLivenessSweep {
  const now = deps.now ?? (() => new Date());
  const failSetup = createSetupFailure({
    repo: deps.repo,
    reaper: deps.reaper,
  });
  let running = false;

  async function failAndReap(
    row: { id: string; owner: string; runId: string | null },
    reason: string,
  ): Promise<void> {
    if (!row.runId) return;
    await deps.repo.fail(row.runId, reason);
    await deps.reaper.reap(row);
  }

  async function expiryReason(row: InvocationRow): Promise<string> {
    if (row.startedAt !== null)
      return `the run passed its time limit of ${Math.round((row.ttlMs ?? row.expiresAt.getTime() - row.startedAt.getTime()) / 60_000)} min`;
    const from = row.runCreatedAt ?? row.createdAt;
    const minutes = Math.round(
      (row.expiresAt.getTime() - from.getTime()) / 60_000,
    );
    const wait = await deps.readStartWait(row.id).catch(() => null);
    const since =
      row.runId === row.id || from.getTime() - row.createdAt.getTime() < 1_000
        ? "of its spawn"
        : "of its run being started";
    return `the sub-agent did not start within ${minutes} min ${since}${wait ? `. ${wait}` : ""}`;
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const expiredAt = now();
      const expired = await deps.repo.listExpiredRunning(
        expiredAt,
        deps.batchSize,
      );
      for (const row of expired) {
        try {
          const reason = await expiryReason(row);
          if (await deps.repo.failExpired(row.runId!, reason, expiredAt))
            await deps.reaper.reap(row);
        } catch (err) {
          process.stderr.write(
            `[invocation-liveness] fail ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }

      const forgotten = await deps.repo.listExpiredIdle(
        expiredAt,
        deps.batchSize,
      );
      for (const row of forgotten) await deps.reaper.reap(row);

      for (const row of await deps.repo.listCancelPending(deps.batchSize)) {
        try {
          await deps.cancel.settled(row);
        } catch (err) {
          process.stderr.write(
            `[invocation-liveness] ending run ${row.runId} of ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }

      const stillRunning = await deps.repo.listRunning(deps.batchSize);
      for (const row of stillRunning) {
        try {
          const refusal = await harnessConfigRefusalFor(
            row,
            deps.readHarnessConfigSupport,
          );
          if (refusal) {
            await failSetup(
              row.id,
              HARNESS_CONFIG_STEP,
              refusal,
              row.runId ?? undefined,
            );
            continue;
          }
          if (
            row.script !== null &&
            (await deps.runsScripts(row.id)) === false
          ) {
            await failSetup(
              row.id,
              SCRIPT_STEP,
              NO_SCRIPT_RUNNER_REASON,
              row.runId ?? undefined,
            );
            continue;
          }
          const restart = await deps.readTargetRestart(row.id);
          if (restart && restart.podRestarts > 0) {
            await failAndReap(
              row,
              `target's machine restarted${restart.podRestartReason ? ` (${restart.podRestartReason})` : ""}; one-shot turn cannot resume`,
            );
          }
        } catch (err) {
          process.stderr.write(
            `[invocation-liveness] check ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }

      const unreaped = await deps.repo.listTerminalUnreaped(
        new Date(now().getTime() - UNREAPED_AFTER_MS),
        deps.batchSize,
      );
      for (const row of unreaped) {
        if (row.status === "done" && !(await deps.reportedReap.due(row)))
          continue;
        await deps.reaper.reap(row);
        try {
          if (!(await deps.hasAgent(row.rootDriverId))) {
            await deps.outputs.purgeRoot(row.rootDriverId);
            await deps.repo.deleteReapedByRoot(row.rootDriverId);
          }
        } catch (err) {
          process.stderr.write(
            `[invocation-liveness] orphan-check ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
      await deps.outputs.purgeExpired(deps.batchSize);
    } finally {
      running = false;
    }
  }

  return { tick };
}
