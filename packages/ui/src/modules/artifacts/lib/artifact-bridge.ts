import type { LibraryArtifact } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the latest version of an interactive HTML page
 * an Agent published, not public, may call its publishing Agent's API from
 * wherever it is shown: a chat's side panel, the Artifacts library or its own
 * browser tab. It needs no chat, as the server checks the artifact again on
 * every call.
 */
export function canUseArtifactAgentApi(
  artifact: LibraryArtifact | null | undefined,
  version: number | undefined,
): boolean {
  return (
    artifact?.interactive === true &&
    artifact.kind === "html" &&
    artifact.visibility !== "public" &&
    artifact.agentId !== null &&
    artifact.version === version
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: sending a prompt into the open chat needs that
 * chat to be the publishing Agent's.
 */
export function canUseArtifactBridge(
  artifact: LibraryArtifact | null | undefined,
  agentId: string | null,
  version: number | undefined,
): boolean {
  return (
    canUseArtifactAgentApi(artifact, version) &&
    agentId !== null &&
    artifact?.agentId === agentId
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: outside any chat, the same page may still ask
 * its publishing Agent for a Session of its own, on its latest version. The
 * server checks the artifact again on every prompt.
 */
export function canStartArtifactSession(
  artifact: LibraryArtifact | null | undefined,
  version: number | undefined,
): boolean {
  return canUseArtifactAgentApi(artifact, version);
}
