import {
  DEFAULT_MAX_APPLY_ATTEMPTS,
  type OutboxRepo,
} from "../infrastructure/outbox-repo.js";
import type { StateQueue } from "../infrastructure/state-queue.js";
import type { IsAgentRunning } from "./worker-handler.js";

export interface CronSweep {
  tick(): Promise<void>;
}

export interface CronSweepDeps {
  outboxRepo: OutboxRepo;
  queue: StateQueue;
  agentRunningPort: IsAgentRunning;
  log: (msg: string) => void;
  maxApplyAttempts?: number;
  runningCheckConcurrency?: number;
  runningCheckTimeoutMs?: number;
}

const DEFAULT_RUNNING_CHECK_CONCURRENCY = 16;
const DEFAULT_RUNNING_CHECK_TIMEOUT_MS = 5_000;

type RunningCheck =
  | { state: "running" }
  | { state: "stopped" }
  | { state: "unknown"; reason: string };

export function createCronSweep(deps: CronSweepDeps): CronSweep {
  const maxApplyAttempts = deps.maxApplyAttempts ?? DEFAULT_MAX_APPLY_ATTEMPTS;
  const checkConcurrency =
    deps.runningCheckConcurrency ?? DEFAULT_RUNNING_CHECK_CONCURRENCY;
  const checkTimeoutMs =
    deps.runningCheckTimeoutMs ?? DEFAULT_RUNNING_CHECK_TIMEOUT_MS;
  let running = false;

  async function checkRunning(agentId: string): Promise<RunningCheck> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `running-state check timed out after ${checkTimeoutMs}ms`,
            ),
          );
        }, checkTimeoutMs);
        timer.unref?.();
      });
      const isRunning = await Promise.race([
        deps.agentRunningPort.isRunning(agentId),
        deadline,
      ]);
      return isRunning ? { state: "running" } : { state: "stopped" };
    } catch (err) {
      return { state: "unknown", reason: (err as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkAll(agentIds: string[]): Promise<RunningCheck[]> {
    const checks = new Array<RunningCheck>(agentIds.length);
    let next = 0;
    const lanes = Array.from(
      { length: Math.min(checkConcurrency, agentIds.length) },
      async () => {
        for (;;) {
          const index = next++;
          if (index >= agentIds.length) return;
          checks[index] = await checkRunning(agentIds[index]!);
        }
      },
    );
    await Promise.all(lanes);
    return checks;
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const retryable = await deps.outboxRepo.listRetryable(maxApplyAttempts);
      const checks = await checkAll(retryable.map((row) => row.agentId));

      const toEnqueue: string[] = [];
      let stopped = 0;
      let unchecked = 0;
      let firstFailure = "";
      retryable.forEach((row, index) => {
        const check = checks[index]!;
        if (check.state === "stopped") {
          stopped += 1;
          return;
        }
        if (check.state === "unknown") {
          unchecked += 1;
          if (firstFailure === "") firstFailure = check.reason;
        }
        toEnqueue.push(row.agentId);
      });

      for (const agentId of toEnqueue) {
        await deps.queue.enqueue(agentId);
      }
      if (toEnqueue.length > 0) {
        deps.log(
          `[runtime-sweep] re-enqueued ${toEnqueue.length} pending rows`,
        );
      }
      if (stopped > 0) {
        deps.log(
          `[runtime-sweep] skipped ${stopped} pending rows for agents that are not Ready`,
        );
      }
      if (unchecked > 0) {
        deps.log(
          `[runtime-sweep] running-state check failed for ${unchecked} pending rows, re-enqueued anyway: ${firstFailure}`,
        );
      }

      const dropped = await deps.outboxRepo.deleteExpiredEvents();
      if (dropped > 0) {
        deps.log(`[runtime-sweep] dropped-expired ${dropped} events`);
      }
    } catch (err) {
      const e = err as Error & { cause?: unknown };
      const cause =
        e.cause instanceof Error ? e.cause.message : String(e.cause);
      deps.log(`[runtime-sweep] tick failed: ${e.message} | cause: ${cause}`);
    } finally {
      running = false;
    }
  }

  return { tick };
}
