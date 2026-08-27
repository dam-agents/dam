import {
  type PageArtifactRequest,
  pageArtifactRequestSchema,
} from "api-server-api";

// UNIT_BOUNDARY_DESCRIPTION: The app listens on its own window, which every frame on the page can post to. Only the artifact's own iframe may ask its agent, and only in the pinned `artifact.request` shape, so both checks live here in one place rather than inside a component effect.
export function readPageRequest(
  event: Pick<MessageEvent, "source" | "data">,
  pageWindow: MessageEventSource | null | undefined,
): PageArtifactRequest | null {
  if (!pageWindow || event.source !== pageWindow) return null;
  const parsed = pageArtifactRequestSchema.safeParse(event.data);
  return parsed.success ? parsed.data : null;
}
