import { type ArtifactContent, INLINE_CONTENT_MAX_BYTES } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Says whether an artifact's loaded content can be
 * edited in place. The platform hands back text far larger than it accepts on
 * an inline update, so editability is gated on the update cap rather than on
 * the preview cap the content arrived under.
 */
export function isEditableContent(
  content: ArtifactContent | null | undefined,
): boolean {
  if (!content || content.binary || content.tooLarge) return false;
  return (
    new TextEncoder().encode(content.content).length <= INLINE_CONTENT_MAX_BYTES
  );
}
