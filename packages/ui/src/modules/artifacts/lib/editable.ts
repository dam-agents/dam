import {
  type ArtifactContent,
  INLINE_CONTENT_MAX_BYTES,
  type LibraryArtifact,
} from "api-server-api";

import { isTextKind } from "./kinds.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one rule that says whether an artifact can be
 * edited in place, asked either of a row or of the loaded text. The platform
 * hands back text far larger than it accepts on an inline update, so
 * editability is gated on the update cap rather than on the preview cap the
 * content arrived under. Every surface that offers Edit must ask this, or it
 * offers an action the save would refuse.
 */
export function isEditableArtifact(artifact: LibraryArtifact): boolean {
  return (
    isTextKind(artifact.kind) && artifact.sizeBytes <= INLINE_CONTENT_MAX_BYTES
  );
}

export function isEditableContent(
  content: ArtifactContent | null | undefined,
): boolean {
  if (!content || content.binary || content.tooLarge) return false;
  return (
    new TextEncoder().encode(content.content).length <= INLINE_CONTENT_MAX_BYTES
  );
}
