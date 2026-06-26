import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  RUNS_PLURAL,
  buildRunObject,
  parseRunStatus,
} from "../infrastructure/run-mappers.js";

// Slightly over the controller's RunPodReadyTimeout (120s) so a controller-set
// Failed/Timeout status surfaces as the error rather than our own generic one.
const READY_TIMEOUT_MS = 125_000;
const POLL_INTERVAL_MS = 500;

export class RunFailedError extends Error {
  constructor(
    public readonly reason: string,
    detail?: string,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "RunFailedError";
  }
}

export interface RunsService {
  /** Generate a fresh DNS-1035-safe Run name. */
  newRunId(): string;
  /** Write the Run CR; the controller materialises the executor pair. */
  create(runId: string, agentId: string): Promise<void>;
  /** Poll until the executor pod is Ready, returning its podIP. Throws
   *  RunFailedError on a failed/timed-out run. */
  waitReady(runId: string, signal: AbortSignal): Promise<string>;
  /** Delete the Run CR; the controller GC-reaps the executor + gateway. */
  delete(runId: string): Promise<void>;
  /** Names of all live Run CRs — used by the boot sweep. */
  listRunIds(): Promise<string[]>;
}

export function createRunsService(k8s: K8sClient): RunsService {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  return {
    newRunId() {
      return `run-${crypto.randomUUID()}`;
    },

    async create(runId, agentId) {
      await k8s.createCustomObject(
        RUNS_PLURAL,
        buildRunObject({ runId, agentId }),
      );
    },

    async waitReady(runId, signal) {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (signal.aborted) throw new RunFailedError("Aborted");
        const obj = await k8s.getCustomObject(RUNS_PLURAL, runId);
        if (!obj)
          throw new RunFailedError("OrchestrationFailed", "run disappeared");
        const status = parseRunStatus(obj);
        if (status?.phase === "Ready" && status.podIP) return status.podIP;
        if (status?.phase === "Failed") {
          throw new RunFailedError(
            status.error?.reason ?? "Failed",
            status.error?.detail,
          );
        }
        await sleep(POLL_INTERVAL_MS);
      }
      throw new RunFailedError(
        "Timeout",
        `executor not Ready after ${READY_TIMEOUT_MS}ms`,
      );
    },

    async delete(runId) {
      await k8s.deleteCustomObject(RUNS_PLURAL, runId).catch(() => {});
    },

    async listRunIds() {
      const objs = await k8s.listCustomObjects(RUNS_PLURAL);
      return objs.map((o) => o.metadata?.name).filter((n): n is string => !!n);
    },
  };
}
