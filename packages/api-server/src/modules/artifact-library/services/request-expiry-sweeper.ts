import { emit, EventType } from "../../../events.js";
import { ARTIFACT_REQUEST_TTL_MS } from "../domain/artifact-request.js";
import type { ArtifactRequestsRepository } from "../infrastructure/artifact-requests-repository.js";

export interface ArtifactRequestExpirySweeper {
  tick(): Promise<number>;
}

export function createArtifactRequestExpirySweeper(deps: {
  requests: ArtifactRequestsRepository;
  batchSize: number;
  now?: () => Date;
}): ArtifactRequestExpirySweeper {
  const now = deps.now ?? (() => new Date());
  return {
    async tick() {
      const cutoff = new Date(now().getTime() - ARTIFACT_REQUEST_TTL_MS);
      const stale = await deps.requests.listStale(cutoff, deps.batchSize);
      let expired = 0;
      for (const row of stale) {
        const settled = await deps.requests.settle(row.id, row.owner, {
          state: "failed",
          failureReason: "expired",
          settledAt: now(),
        });
        if (!settled) continue;
        expired += 1;
        emit({
          type: EventType.ArtifactRequestSettled,
          requestId: settled.id,
          artifactId: settled.artifactId,
          agentId: settled.agentId,
          ownerSub: settled.owner,
          seq: settled.seq,
          action: settled.action,
          state: "failed",
          failureReason: "expired",
        });
      }
      if (expired > 0) {
        process.stderr.write(
          `[artifact-requests] expired ${expired} unanswered request(s)\n`,
        );
      }
      return expired;
    },
  };
}
