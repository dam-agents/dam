import type { LibraryArtifact } from "api-server-api";

export function canUseArtifactBridge(
  artifact: LibraryArtifact | null | undefined,
  enabled: boolean,
  agentId: string | null,
  version: number | undefined,
): boolean {
  return (
    enabled &&
    artifact?.interactive === true &&
    artifact.kind === "html" &&
    artifact.visibility !== "public" &&
    agentId !== null &&
    artifact.agentId === agentId &&
    artifact.version === version
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: outside any chat, the same page may still ask
 * its publishing Agent for a Session of its own, on its latest version with
 * the feature on. The server checks the artifact again on every prompt.
 */
export function canStartArtifactSession(
  artifact: LibraryArtifact | null | undefined,
  enabled: boolean,
  version: number | undefined,
): boolean {
  return (
    artifact?.agentId != null &&
    canUseArtifactBridge(artifact, enabled, artifact.agentId, version)
  );
}
