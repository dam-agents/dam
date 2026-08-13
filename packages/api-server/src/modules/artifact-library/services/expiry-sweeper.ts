import type { ArtifactService } from "../../artifacts/services/artifact-service.js";
import { emit, EventType } from "../../../events.js";
import type { ArtifactLibraryRepository } from "../infrastructure/artifact-library-repository.js";
import { EXPIRATION_GRACE_PERIOD_DAYS } from "./share-viewer-service.js";

export interface ArtifactExpirySweeper {
  tick(): Promise<number>;
}

export function createArtifactExpirySweeper(deps: {
  repo: ArtifactLibraryRepository;
  artifacts: ArtifactService;
  batchSize: number;
}): ArtifactExpirySweeper {
  return {
    async tick() {
      const cutoff = new Date(
        Date.now() - EXPIRATION_GRACE_PERIOD_DAYS * 86_400_000,
      );
      const rows = await deps.repo.listExpiredBefore(cutoff, deps.batchSize);
      let deletedCount = 0;
      for (const row of rows) {
        const deleted = await deps.repo.deleteArtifactWithVersions(
          row.id,
          row.owner,
        );
        if (!deleted) continue;
        deletedCount += 1;
        emit({
          type: EventType.ArtifactDeleted,
          artifactId: row.id,
          ownerSub: row.owner,
          ...(deleted.artifact.agentId
            ? { agentId: deleted.artifact.agentId }
            : {}),
        });
        await Promise.allSettled(
          [
            deleted.artifact.storageRef,
            ...deleted.versions.map((v) => v.storageRef),
          ].map((ref) => deps.artifacts.delete(ref)),
        );
      }
      if (deletedCount > 0) {
        process.stderr.write(
          `[artifact-expiry-sweeper] deleted ${deletedCount} expired artifact(s)\n`,
        );
      }
      return deletedCount;
    },
  };
}
