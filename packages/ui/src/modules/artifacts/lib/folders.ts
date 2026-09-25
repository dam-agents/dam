import type { ArtifactFolder } from "api-server-api";

export function folderDisplayNames(
  folders: readonly ArtifactFolder[],
): Map<string, string> {
  return new Map(folders.map((folder) => [folder.id, folder.name]));
}
