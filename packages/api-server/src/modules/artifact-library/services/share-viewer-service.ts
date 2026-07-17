import type { ArtifactService } from "../../artifacts/services/artifact-service.js";
import type {
  ArtifactLibraryRepository,
  ArtifactRow,
  FolderRow,
} from "../infrastructure/artifact-library-repository.js";

/** Days an expired artifact keeps answering with a "recently expired" page
 *  (and survives the sweeper) — slop's grace-window behavior. */
export const EXPIRATION_GRACE_PERIOD_DAYS = 7;

export type SharedResolution =
  | { state: "not-found" }
  | { state: "expired"; withinGrace: boolean; expiredAt: Date }
  | { state: "ok"; artifact: ArtifactRow };

export type FolderResolution =
  | { state: "not-found" }
  | { state: "ok"; folder: FolderRow; artifacts: ArtifactRow[] };

/** Boot-scoped (owner-agnostic) read surface for the public share host. Only
 *  `visibility = public` rows resolve — everything else reads as not-found so
 *  the viewer can never leak a private artifact's existence. The unguessable
 *  slug is the whole access control: whoever holds the link may view. */
export interface ShareViewerService {
  resolveArtifact(slug: string): Promise<SharedResolution>;
  resolveFolder(slug: string): Promise<FolderResolution>;
  /** Bytes for a resolved artifact (optionally a past version). */
  content(
    artifact: ArtifactRow,
    version?: number,
  ): Promise<{
    content: Buffer;
    contentType: string;
    sizeBytes: number;
  } | null>;
  /** Prior version count for the version-nav strip. */
  versionCount(artifactId: string): Promise<number>;
  recordView(artifactId: string): void;
}

export function createShareViewerService(deps: {
  repo: ArtifactLibraryRepository;
  artifacts: ArtifactService;
}): ShareViewerService {
  const { repo, artifacts } = deps;

  function expiryState(
    row: ArtifactRow,
  ): { expired: true; withinGrace: boolean } | { expired: false } {
    if (!row.expiresAt || row.expiresAt.getTime() > Date.now())
      return { expired: false };
    const graceEnd =
      row.expiresAt.getTime() + EXPIRATION_GRACE_PERIOD_DAYS * 86_400_000;
    return { expired: true, withinGrace: Date.now() < graceEnd };
  }

  return {
    async resolveArtifact(slug) {
      const row = await repo.getArtifactBySlug(slug);
      if (!row || row.visibility !== "public") return { state: "not-found" };
      const expiry = expiryState(row);
      if (expiry.expired) {
        return {
          state: "expired",
          withinGrace: expiry.withinGrace,
          expiredAt: row.expiresAt!,
        };
      }
      return { state: "ok", artifact: row };
    },

    async resolveFolder(slug) {
      const folder = await repo.getFolderBySlug(slug);
      if (!folder) return { state: "not-found" };
      const artifacts = await repo.listSharedInFolder(folder.id);
      // A folder with nothing shared inside is indistinguishable from a
      // nonexistent one — folder pages exist only as an index of shared work.
      if (artifacts.length === 0) return { state: "not-found" };
      return { state: "ok", folder, artifacts };
    },

    async content(artifact, version) {
      const ref =
        version === undefined || version === artifact.version
          ? {
              storageRef: artifact.storageRef,
              contentType: artifact.contentType,
            }
          : await repo.getVersion(artifact.id, version);
      if (!ref) return null;
      const blob = await artifacts.get(ref.storageRef);
      if (!blob) return null;
      return {
        content: blob.content,
        contentType: ref.contentType,
        sizeBytes: blob.sizeBytes,
      };
    },

    async versionCount(artifactId) {
      const prior = await repo.listVersions(artifactId);
      return prior.length + 1;
    },

    recordView(artifactId) {
      // Fire-and-forget — a lost increment is preferable to a slower render.
      void repo.incrementViewCount(artifactId).catch(() => {});
    },
  };
}
