import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import type { ForkFailureReason } from "../../../events.js";
import type { ForkSpec, ForkStatus } from "../domain/fork.js";
import {
  LABEL_FORK_ID,
  LABEL_AGENT_REF,
  LABEL_TYPE,
  SPEC_KEY,
  SPEC_VERSION,
  STATUS_KEY,
  TYPE_AGENT_FORK,
} from "./labels.js";

interface ForkSpecYaml {
  version: string;
  agentName: string;
  foreignSub: string;
  sessionId?: string;
}

interface ForkStatusYaml {
  version?: string;
  phase?: string;
  jobName?: string;
  podIP?: string;
  error?: { reason?: string; detail?: string };
}

export function buildForkConfigMap(args: {
  forkId: string;
  spec: ForkSpec;
}): k8s.V1ConfigMap {
  const body: ForkSpecYaml = {
    version: SPEC_VERSION,
    agentName: args.spec.agentId,
    foreignSub: args.spec.foreignSub,
  };
  if (args.spec.sessionId !== undefined) body.sessionId = args.spec.sessionId;

  return {
    metadata: {
      name: args.forkId,
      labels: {
        [LABEL_TYPE]: TYPE_AGENT_FORK,
        [LABEL_AGENT_REF]: args.spec.agentId,
        [LABEL_FORK_ID]: args.forkId,
      },
    },
    data: { [SPEC_KEY]: yaml.dump(body) },
  };
}

export function parseForkStatus(cm: k8s.V1ConfigMap): ForkStatus | null {
  const raw = cm.data?.[STATUS_KEY];
  if (!raw) return null;
  const parsed = yaml.load(raw) as ForkStatusYaml | null;
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
