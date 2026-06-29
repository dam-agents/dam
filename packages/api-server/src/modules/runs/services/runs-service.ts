import { z } from "zod";
import type { RunSpecCR } from "api-server-api";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";

const RUNS_PLURAL = "runs";
const API_VERSION = "agent-platform.ai/v1";

// Slightly over the controller's RunPodReadyTimeout (120s) so a controller-set
// Failed/Timeout status surfaces as the error rather than our own generic one.
const READY_TIMEOUT_MS = 125_000;
const POLL_INTERVAL_MS = 500;

const runStatusSchema = z
  .object({
    phase: z.string().optional(),
    podIP: z.string().optional(),
    error: z
      .object({ reason: z.string().optional(), detail: z.string().optional() })
      .optional(),
  })
  .nullish();

export class RunFailedError extends Error {
  constructor(reason: string, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "RunFailedError";
  }
}

export interface RunsService {
  /** Generate a fresh DNS-1035-safe Run name. */
  newRunId(): string;
  /** Write the Run CR, owner-refed to the parent Agent (by uid) for cascade
   *  deletion; the controller materialises the executor pair. */
  create(runId: string, agentId: string, agentUid: string): Promise<void>;
  /** Poll until the executor pod is Ready, returning its podIP. Throws
   *  RunFailedError on a failed/timed-out run. */
  waitReady(runId: string, signal: AbortSignal): Promise<string>;
  /** Delete the Run CR; the controller GC-reaps the executor + gateway. */
  delete(runId: string): Promise<void>;
  /** Names of all live Run CRs — used by the boot sweep. */
  listRunIds(): Promise<string[]>;
}

export function createRunsService(k8s: K8sClient): RunsService {
  return {
    newRunId() {
      return `run-${crypto.randomUUID()}`;
    },

    async create(runId, agentId, agentUid) {
      // CR labels are for kubectl/debugging; GC is by the owner reference to
      // the parent Agent, so deleting it cascade-deletes in-flight Runs.
      await k8s.createCustomObject(RUNS_PLURAL, {
        apiVersion: API_VERSION,
        kind: "Run",
        metadata: {
          name: runId,
          labels: {
            "agent-platform.ai/agent": agentId,
            "agent-platform.ai/run-id": runId,
          },
          ownerReferences: [
            {
              apiVersion: API_VERSION,
              kind: "Agent",
              name: agentId,
              uid: agentUid,
            },
          ],
        },
        spec: { agentName: agentId } satisfies RunSpecCR,
      });
    },

    async waitReady(runId, signal) {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (signal.aborted) throw new RunFailedError("Aborted");
        const obj = await k8s.getCustomObject(RUNS_PLURAL, runId);
        if (!obj)
          throw new RunFailedError("OrchestrationFailed", "run disappeared");
        const status = runStatusSchema.parse(obj.status ?? null);
        if (status?.phase === "Ready" && status.podIP) return status.podIP;
        if (status?.phase === "Failed") {
          throw new RunFailedError(
            status.error?.reason ?? "Failed",
            status.error?.detail,
          );
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
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
