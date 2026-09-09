import { artifactInternalLink, type LibraryArtifact } from "api-server-api";

export function toAgentArtifact(artifact: LibraryArtifact) {
  return {
    id: artifact.id,
    title: artifact.title,
    slug: artifact.slug,
    kind: artifact.kind,
    contentType: artifact.contentType,
    fileName: artifact.fileName,
    sizeBytes: artifact.sizeBytes,
    version: artifact.version,
    folderId: artifact.folderId,
    agentId: artifact.agentId,
    visibility: artifact.visibility,
    expiresAt: artifact.expiresAt,
    viewCount: artifact.viewCount,
    shareUrl: artifact.shareUrl,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    internal_link: artifactInternalLink(artifact.id),
  };
}
