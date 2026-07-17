/**
 * Hard-deletes artifacts whose expiry passed more than the grace window ago.
 * Expiry is a retention setting on the artifact itself, not just its share
 * link: it applies regardless of visibility (a private artifact with an
 * expiry is deleted too — storage lifecycle is a separate concern from
 * sharing). On the public side it doubles as the durable dual of the
 * viewer's 410 pages: recently expired links say "expired" (and the owner
 * can still renew), long-expired content stops existing.
 *
 * This is only the tick — scheduling lives on the platform periodic-jobs
 * queue (one execution per period across replicas). The tick stays safe
 * under at-least-once execution: the scan is read-only and deletes are
 * transactional and idempotent (a raced row just no-ops).
 */
import type { ArtifactService } from "../../artifacts/services/artifact-service.js";
import type { ArtifactLibraryRepository } from "../infrastructure/artifact-library-repository.js";
import { EXPIRATION_GRACE_PERIOD_DAYS } from "./share-viewer-service.js";

export interface ArtifactExpirySweeper {
  /** One scan; returns how many artifacts were deleted. */
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
        if (!deleted) continue; // raced by a concurrent tick
        deletedCount += 1;
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
