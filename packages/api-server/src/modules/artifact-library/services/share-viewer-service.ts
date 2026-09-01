import { ARTIFACT_RESTORE_WINDOW_DAYS } from "api-server-api";

import type { ArtifactService } from "../../artifacts/services/artifact-service.js";
import type {
  ArtifactLibraryRepository,
  ArtifactRow,
  FolderRow,
} from "../infrastructure/artifact-library-repository.js";
import { emit, EventType } from "../../../events.js";

export type SharedResolution =
  | { state: "not-found" }
  | { state: "expired"; withinGrace: boolean }
  | { state: "ok"; artifact: ArtifactRow };

export type FolderResolution =
  | { state: "not-found" }
  | { state: "ok"; folder: FolderRow; artifacts: ArtifactRow[] };

export interface ShareViewerService {
  resolveArtifact(slug: string): Promise<SharedResolution>;
  resolveFolder(slug: string): Promise<FolderResolution>;
  meta(
    artifact: ArtifactRow,
    version?: number,
  ): Promise<{ contentType: string; sizeBytes: number } | null>;
  content(
    artifact: ArtifactRow,
    version?: number,
    maxBytes?: number,
  ): Promise<{
    content: Buffer;
    contentType: string;
    sizeBytes: number;
  } | null>;
  contentStream(
    artifact: ArtifactRow,
    version?: number,
  ): Promise<{
    stream: ReadableStream<Uint8Array>;
    contentType: string;
    sizeBytes: number;
  } | null>;
  versionCount(artifactId: string): Promise<number>;
  recordView(artifact: ArtifactRow): void;
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
      row.expiresAt.getTime() + ARTIFACT_RESTORE_WINDOW_DAYS * 86_400_000;
    return { expired: true, withinGrace: Date.now() < graceEnd };
  }

  async function resolveRef(
    artifact: ArtifactRow,
    version?: number,
  ): Promise<{
    storageRef: string;
    contentType: string;
    sizeBytes: number;
  } | null> {
    if (version === undefined || version === artifact.version) {
      return {
        storageRef: artifact.storageRef,
        contentType: artifact.contentType,
        sizeBytes: artifact.sizeBytes,
      };
    }
    return repo.getVersion(artifact.id, version);
  }

  return {
    async resolveArtifact(slug) {
      const row = await repo.getArtifactBySlug(slug);
      if (!row || row.visibility !== "public") return { state: "not-found" };
      const expiry = expiryState(row);
      if (expiry.expired) {
        return { state: "expired", withinGrace: expiry.withinGrace };
      }
      return { state: "ok", artifact: row };
    },

    async resolveFolder(slug) {
      const folder = await repo.getFolderBySlug(slug);
      if (!folder) return { state: "not-found" };
      const artifacts = await repo.listSharedInFolder(folder.id);
      if (artifacts.length === 0) return { state: "not-found" };
      return { state: "ok", folder, artifacts };
    },

    async meta(artifact, version) {
      const ref = await resolveRef(artifact, version);
      return ref
        ? { contentType: ref.contentType, sizeBytes: ref.sizeBytes }
        : null;
    },

    async content(artifact, version, maxBytes) {
      const ref = await resolveRef(artifact, version);
      if (!ref) return null;
      if (maxBytes !== undefined && ref.sizeBytes > maxBytes) return null;
      const blob = await artifacts.get(ref.storageRef);
      if (!blob) return null;
      return {
        content: blob.content,
        contentType: ref.contentType,
        sizeBytes: blob.sizeBytes,
      };
    },

    async contentStream(artifact, version) {
      const ref = await resolveRef(artifact, version);
      if (!ref) return null;
      const streamed = await artifacts.getStream(ref.storageRef);
      if (!streamed) return null;
      return { ...streamed, contentType: ref.contentType };
    },

    async versionCount(artifactId) {
      const rows = await repo.listVersions(artifactId);
      return rows.length;
    },

    recordView(artifact) {
      void repo.incrementViewCount(artifact.id).catch(() => {});
      emit({
        type: EventType.ArtifactViewed,
        artifactId: artifact.id,
        ownerSub: artifact.owner,
      });
    },
  };
}
