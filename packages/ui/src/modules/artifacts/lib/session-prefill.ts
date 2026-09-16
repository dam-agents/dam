import { artifactInternalLink, type LibraryArtifact } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The line a continuation session starts from. The
 * title reads for the person, and `platform://artifacts/<id>` is the reference
 * an Agent's artifact tools take, so the same line serves both readers.
 */
export function artifactSessionPrefill(artifact: LibraryArtifact): string {
  return `${artifact.title} — ${artifactInternalLink(artifact.id)}`;
}
