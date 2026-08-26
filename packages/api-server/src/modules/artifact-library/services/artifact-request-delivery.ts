import type { ArtifactRequestFailureReason } from "api-server-api";

import { isAgentWakeTimeoutError } from "../../agents/index.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { ARTIFACT_REQUEST_TTL_MS } from "../domain/artifact-request.js";

export interface ArtifactRequestDeliveryInput {
  requestId: string;
  artifactId: string;
  agentId: string;
  task: string;
}

export type ArtifactRequestDeliveryOutcome =
  | { ok: true }
  | { ok: false; reason: ArtifactRequestFailureReason };

export interface ArtifactRequestDelivery {
  deliver(
    input: ArtifactRequestDeliveryInput,
  ): Promise<ArtifactRequestDeliveryOutcome>;
}

export interface ArtifactRequestDeliveryDeps {
  runtimeMutator: RuntimeMutator;
  ensureAgentReady: (agentId: string) => Promise<void>;
  now?: () => Date;
  log?: (msg: string) => void;
}

function wakeReason(error: unknown): ArtifactRequestFailureReason {
  if (!isAgentWakeTimeoutError(error)) return "wake_failed";
  if (error.failure.kind === "not-found") return "agent_deleted";
  if (error.failure.kind === "over-budget") return "over_budget";
  return "wake_failed";
}

export function createArtifactRequestDelivery(
  deps: ArtifactRequestDeliveryDeps,
): ArtifactRequestDelivery {
  const now = deps.now ?? (() => new Date());
  const log =
    deps.log ??
    ((msg: string) => process.stderr.write(`[artifact-requests] ${msg}\n`));

  return {
    async deliver({ requestId, artifactId, agentId, task }) {
      const firedAt = now().getTime();
      const expiresAt = new Date(firedAt + ARTIFACT_REQUEST_TTL_MS);
      try {
        await deps.runtimeMutator.bump(agentId, [
          {
            id: `artifact-request:${requestId}:${firedAt}`,
            kind: "artifact-request",
            payload: { requestId, artifactId, task },
            expiresAt,
          },
        ]);
        await deps.runtimeMutator.enqueueAfterCommit(agentId);
      } catch (error) {
        log(`request ${requestId} could not be queued: ${String(error)}`);
        return { ok: false, reason: "wake_failed" };
      }
      try {
        await deps.ensureAgentReady(agentId);
      } catch (error) {
        const reason = wakeReason(error);
        log(`request ${requestId} wake failed as ${reason}: ${String(error)}`);
        return { ok: false, reason };
      }
      return { ok: true };
    },
  };
}
