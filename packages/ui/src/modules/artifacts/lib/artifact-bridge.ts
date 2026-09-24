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
    artifact.visibility === "private" &&
    agentId !== null &&
    artifact.agentId === agentId &&
    artifact.version === version
  );
}
