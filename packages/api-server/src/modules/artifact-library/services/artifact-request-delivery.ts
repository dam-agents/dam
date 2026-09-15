import type { ArtifactRequestFailureReason } from "api-server-api";

import { isAgentWakeTimeoutError } from "../../agents/index.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { ARTIFACT_REQUEST_TTL_MS } from "../domain/artifact-request.js";

export interface ArtifactRequestDeliveryInput {
  requestId: string;
  artifactId: string;
  agentId: string;
  sessionId: string;
  task: string;
}

export type ArtifactRequestDeliveryOutcome =
  | { ok: true }
  | { ok: false; reason: ArtifactRequestFailureReason };

export interface ArtifactRequestDelivery {
  checkBinding(input: {
    requestId: string;
    agentId: string;
    sessionId: string;
  }): Promise<ArtifactRequestDeliveryOutcome>;
  deliver(
    input: ArtifactRequestDeliveryInput,
  ): Promise<ArtifactRequestDeliveryOutcome>;
}

export interface ArtifactRequestDeliveryDeps {
  runtimeMutator: RuntimeMutator;
  ensureAgentReady: (agentId: string) => Promise<void>;
  listSessions: (agentId: string) => Promise<readonly { sessionId: string }[]>;
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

  async function wake(
    requestId: string,
    agentId: string,
  ): Promise<ArtifactRequestDeliveryOutcome> {
    try {
      await deps.ensureAgentReady(agentId);
      return { ok: true };
    } catch (error) {
      const reason = wakeReason(error);
      log(`request ${requestId} wake failed as ${reason}: ${String(error)}`);
      return { ok: false, reason };
    }
  }

  return {
    async checkBinding({ requestId, agentId, sessionId }) {
      const ready = await wake(requestId, agentId);
      if (!ready.ok) return ready;
      let sessions: readonly { sessionId: string }[];
      try {
        sessions = await deps.listSessions(agentId);
      } catch (error) {
        log(
          `request ${requestId} could not read the agent's conversations: ${String(error)}`,
        );
        return { ok: false, reason: "wake_failed" };
      }
      if (sessions.some((session) => session.sessionId === sessionId))
        return { ok: true };
      log(`request ${requestId} is bound to ${sessionId}, which is gone`);
      return { ok: false, reason: "session_deleted" };
    },

    async deliver({ requestId, artifactId, agentId, sessionId, task }) {
      const firedAt = now().getTime();
      const expiresAt = new Date(firedAt + ARTIFACT_REQUEST_TTL_MS);
      try {
        await deps.runtimeMutator.bump(agentId, [
          {
            id: `artifact-request:${requestId}:${firedAt}`,
            kind: "artifact-request",
            payload: { requestId, artifactId, task, sessionId },
            expiresAt,
          },
        ]);
        await deps.runtimeMutator.enqueueAfterCommit(agentId);
      } catch (error) {
        log(`request ${requestId} could not be queued: ${String(error)}`);
        return { ok: false, reason: "wake_failed" };
      }
      return wake(requestId, agentId);
    },
  };
}
