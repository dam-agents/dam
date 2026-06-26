import { z } from "zod";
import type { RunSpecCR } from "api-server-api";

// agent-platform.ai/v1 Run custom-resource coordinates + CR labels (for
// kubectl/debugging; GC is by owner reference, set by the controller).
export const RUNS_PLURAL = "runs";
export const KIND_RUN = "Run";
export const GROUP = "agent-platform.ai";
export const VERSION = "v1";
export const LABEL_AGENT_REF = "agent-platform.ai/agent";
export const LABEL_RUN_ID = "agent-platform.ai/run-id";

export type RunPhase = "Pending" | "Ready" | "Failed" | "Completed";

export interface RunStatus {
  readonly phase: RunPhase;
  readonly podIP?: string;
  readonly error?: { reason: string; detail?: string };
}

interface OwnerReference {
  apiVersion: string;
  kind: string;
  name: string;
  uid: string;
}

/** The agent-platform.ai/v1 Run custom resource. The api-server writes spec;
 *  the controller owns the status subresource. */
export interface RunObject {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    labels?: Record<string, string>;
    ownerReferences?: OwnerReference[];
  };
  spec: RunSpecCR;
}

export function buildRunObject(args: {
  runId: string;
  agentId: string;
  agentUid?: string;
}): RunObject {
  return {
    apiVersion: `${GROUP}/${VERSION}`,
    kind: KIND_RUN,
    metadata: {
      name: args.runId,
      labels: {
        [LABEL_AGENT_REF]: args.agentId,
        [LABEL_RUN_ID]: args.runId,
      },
      // Owner-ref the parent Agent so deleting it cascade-deletes in-flight
      // Runs (and their executor pods, owned by the Run). Set atomically at
      // create — no controller-side reconcile needed. Backed by the
      // controller's hard-lifetime reaper when no uid is known.
      ...(args.agentUid
        ? {
            ownerReferences: [
              {
                apiVersion: `${GROUP}/${VERSION}`,
                kind: "Agent",
                name: args.agentId,
                uid: args.agentUid,
              },
            ],
          }
        : {}),
    },
    spec: { agentName: args.agentId },
  };
}

const runStatusSchema = z
  .object({
    phase: z.string().optional(),
    podIP: z.string().optional(),
    error: z
      .object({ reason: z.string().optional(), detail: z.string().optional() })
      .optional(),
  })
  .nullish();

/** Read the Run's observed status off the CR status subresource. Returns null
 *  until the controller has written a recognised phase. */
export function parseRunStatus(obj: { status?: unknown }): RunStatus | null {
  const parsed = runStatusSchema.parse(obj.status ?? null);
  if (!parsed?.phase) return null;
  const phase = normalisePhase(parsed.phase);
  if (!phase) return null;
  const status: RunStatus = { phase };
  if (parsed.podIP) (status as { podIP?: string }).podIP = parsed.podIP;
  if (parsed.error?.reason) {
    (status as { error?: { reason: string; detail?: string } }).error = {
      reason: parsed.error.reason,
      ...(parsed.error.detail !== undefined
        ? { detail: parsed.error.detail }
        : {}),
    };
  }
  return status;
}

function normalisePhase(phase: string): RunPhase | null {
  switch (phase) {
    case "Pending":
    case "Ready":
    case "Failed":
    case "Completed":
      return phase;
    default:
      return null;
  }
}
