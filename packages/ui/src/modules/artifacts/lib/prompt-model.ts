import type { LibraryArtifact } from "api-server-api";

/** UNIT_BOUNDARY_DESCRIPTION: whether a page's prompts open Sessions of their own, which are the only ones a model picked for the page reaches: an interactive HTML page an Agent published, never public. */
export function picksPromptModel(artifact: LibraryArtifact): boolean {
  return (
    artifact.kind === "html" &&
    artifact.interactive &&
    artifact.agentId !== null &&
    artifact.visibility !== "public"
  );
}
