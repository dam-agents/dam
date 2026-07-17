import type { ArtifactKind } from "api-server-api";

/** Kinds that render live in the sandboxed preview iframe (with a Source
 *  toggle). Everything else previews directly: highlighted source, inline
 *  image, or a download note. */
const RENDERED_KINDS: ReadonlySet<ArtifactKind> = new Set([
  "html",
  "jsx",
  "markdown",
]);

export function isRenderedKind(kind: ArtifactKind): boolean {
  return RENDERED_KINDS.has(kind);
}
