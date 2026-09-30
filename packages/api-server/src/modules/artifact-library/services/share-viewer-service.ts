import { match } from "ts-pattern";
import { ARTIFACT_RESTORE_WINDOW_DAYS } from "api-server-api";

import type { ArtifactService } from "../../artifacts/services/artifact-service.js";
import type { ShareSession } from "../domain/share-session.js";
import {
  decideRestrictedView,
  type ViewDecision,
} from "../domain/viewer-access.js";
import type {
  ArtifactLibraryRepository,
  ArtifactRow,
  FolderRow,
} from "../infrastructure/artifact-library-repository.js";
import { emit, EventType } from "../../../events.js";

export type SharedResolution =
  | { state: "not-found" }
  | { state: "expired"; withinGrace: boolean }
  | { state: "ok"; artifact: ArtifactRow }
  | { state: "restricted"; artifact: ArtifactRow };

export type FolderResolution =
  | { state: "not-found" }
  | { state: "ok"; folder: FolderRow; artifacts: ArtifactRow[] };

export interface ShareViewerService {
  resolveArtifact(slug: string): Promise<SharedResolution>;
  resolveFolder(slug: string): Promise<FolderResolution>;
  canView(artifact: ArtifactRow, session: ShareSession): Promise<ViewDecision>;
  content(
    artifact: ArtifactRow,
    maxBytes?: number,
  ): Promise<{
    content: Buffer;
    contentType: string;
    sizeBytes: number;
  } | null>;
  contentStream(artifact: ArtifactRow): Promise<{
    stream: ReadableStream<Uint8Array>;
    contentType: string;
    sizeBytes: number;
  } | null>;
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

  return {
    async resolveArtifact(slug) {
      const row = await repo.getArtifactBySlug(slug);
      if (!row) return { state: "not-found" };
      if (row.visibility === "private") return { state: "not-found" };
      const expiry = expiryState(row);
      if (expiry.expired) {
        return { state: "expired", withinGrace: expiry.withinGrace };
      }
      return match(row.visibility)
        .with("public", () => ({ state: "ok", artifact: row }) as const)
        .with(
          "restricted",
          () => ({ state: "restricted", artifact: row }) as const,
        )
        .exhaustive();
    },

    async canView(artifact, session) {
      const viewers = await repo.listViewers(artifact.id);
      return decideRestrictedView(artifact, session, viewers);
    },

    async resolveFolder(slug) {
      const folder = await repo.getFolderBySlug(slug);
      if (!folder) return { state: "not-found" };
      const artifacts = await repo.listSharedInFolder(folder.id);
      if (artifacts.length === 0) return { state: "not-found" };
      return { state: "ok", folder, artifacts };
    },

    async content(artifact, maxBytes) {
      if (maxBytes !== undefined && artifact.sizeBytes > maxBytes) return null;
      const blob = await artifacts.get(artifact.storageRef);
      if (!blob) return null;
      return {
        content: blob.content,
        contentType: artifact.contentType,
        sizeBytes: blob.sizeBytes,
      };
    },

    async contentStream(artifact) {
      const streamed = await artifacts.getStream(artifact.storageRef);
      if (!streamed) return null;
      return { ...streamed, contentType: artifact.contentType };
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
