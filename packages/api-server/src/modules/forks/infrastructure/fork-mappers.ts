import { z } from "zod";
import type { ForkSpecCR } from "api-server-api";
import type { ForkFailureReason } from "../../../events.js";
import type { ForkSpec, ForkStatus } from "../domain/fork.js";
import {
  GROUP,
  KIND_FORK,
  LABEL_AGENT_REF,
  LABEL_FORK_ID,
  VERSION,
} from "./labels.js";

/** The agent-platform.ai/v1 Fork custom resource (ADR-058). The api-server
 *  writes spec; the controller owns the status subresource. */
export interface ForkObject {
  apiVersion: string;
  kind: string;
  metadata: { name: string; labels?: Record<string, string> };
  spec: ForkSpecCR;
  status?: unknown;
}

const forkStatusSchema = z
  .object({
    phase: z.string().optional(),
    jobName: z.string().optional(),
    podIP: z.string().optional(),
    error: z
      .object({
        reason: z.string().optional(),
        detail: z.string().optional(),
      })
      .optional(),
  })
  .nullish();

export function buildForkObject(args: {
  forkId: string;
  spec: ForkSpec;
}): ForkObject {
  const spec: ForkSpecCR = {
    agentName: args.spec.agentId,
    foreignSub: args.spec.foreignSub,
  };
  if (args.spec.sessionId !== undefined) spec.sessionId = args.spec.sessionId;

  return {
    apiVersion: `${GROUP}/${VERSION}`,
    kind: KIND_FORK,
    metadata: {
      name: args.forkId,
      labels: {
        [LABEL_AGENT_REF]: args.spec.agentId,
        [LABEL_FORK_ID]: args.forkId,
      },
    },
    spec,
  };
}

/** Read the Fork's observed status off the CR status subresource. Returns null
 *  until the controller has written a recognised phase. */
export function parseForkStatus(obj: { status?: unknown }): ForkStatus | null {
  const parsed = forkStatusSchema.parse(obj.status ?? null);
  if (!parsed || !parsed.phase) return null;
  const phase = normalisePhase(parsed.phase);
  if (!phase) return null;
  const status: ForkStatus = { phase };
  if (parsed.podIP) (status as { podIP?: string }).podIP = parsed.podIP;
  if (parsed.error?.reason) {
    const reason = normaliseReason(parsed.error.reason);
    if (reason) {
      (
        status as { error?: { reason: ForkFailureReason; detail?: string } }
      ).error = {
        reason,
        ...(parsed.error.detail !== undefined
          ? { detail: parsed.error.detail }
          : {}),
      };
    }
  }
  return status;
}

function normalisePhase(phase: string): ForkStatus["phase"] | null {
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

function normaliseReason(reason: string): ForkFailureReason | null {
  switch (reason) {
    case "CredentialMintFailed":
    case "OrchestrationFailed":
    case "PodNotReady":
    case "Timeout":
      return reason;
    default:
      return null;
  }
}
