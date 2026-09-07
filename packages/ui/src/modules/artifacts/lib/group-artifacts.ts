import type { ArtifactFolder, LibraryArtifact } from "api-server-api";

import { isExperimentFolder } from "./folders.js";

export const UNGROUPED_KEY = "ungrouped";

export interface ArtifactFolderGroup {
  key: string;
  folder: ArtifactFolder | null;
  artifacts: LibraryArtifact[];
}

export function groupArtifactsByFolder(
  artifacts: readonly LibraryArtifact[],
  folders: readonly ArtifactFolder[],
  {
    includeEmptyUngrouped = false,
    includeEmptyExperimentFolders = false,
  }: {
    includeEmptyUngrouped?: boolean;
    includeEmptyExperimentFolders?: boolean;
  } = {},
): ArtifactFolderGroup[] {
  const byFolder = new Map<string | null, LibraryArtifact[]>();
  for (const artifact of artifacts) {
    const key = artifact.folderId;
    byFolder.set(key, [...(byFolder.get(key) ?? []), artifact]);
  }

  const groups: ArtifactFolderGroup[] = folders
    .filter(
      (folder) =>
        !isExperimentFolder(folder) ||
        includeEmptyExperimentFolders ||
        (byFolder.get(folder.id) ?? []).length > 0,
    )
    .map((folder) => ({
      key: folder.id,
      folder,
      artifacts: byFolder.get(folder.id) ?? [],
    }));

  const knownFolderIds = new Set(folders.map((f) => f.id));
  const ungrouped = artifacts.filter(
    (a) => a.folderId === null || !knownFolderIds.has(a.folderId),
  );
  if (ungrouped.length > 0 || includeEmptyUngrouped)
    groups.push({ key: UNGROUPED_KEY, folder: null, artifacts: ungrouped });

  return groups;
}
