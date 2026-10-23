import type { ArtifactKind } from "api-server-api";

const RENDERED_KINDS: ReadonlySet<ArtifactKind> = new Set([
  "html",
  "jsx",
  "markdown",
]);

export function isRenderedKind(kind: ArtifactKind): boolean {
  return RENDERED_KINDS.has(kind);
}
