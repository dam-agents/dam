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
  { includeEmptyUngrouped = false }: { includeEmptyUngrouped?: boolean } = {},
): ArtifactFolderGroup[] {
  const byFolder = new Map<string | null, LibraryArtifact[]>();
  for (const artifact of artifacts) {
    const key = artifact.folderId;
    byFolder.set(key, [...(byFolder.get(key) ?? []), artifact]);
  }

  const groups: ArtifactFolderGroup[] = folders
    .filter((folder) => !isExperimentFolder(folder))
    .map((folder) => ({
      key: folder.id,
      folder,
      artifacts: byFolder.get(folder.id) ?? [],
    }));

  for (const folder of folders) {
    if (!isExperimentFolder(folder)) continue;
    const inFolder = byFolder.get(folder.id) ?? [];
    if (inFolder.length > 0)
      groups.push({ key: folder.id, folder, artifacts: inFolder });
  }

  const knownFolderIds = new Set(folders.map((f) => f.id));
  const ungrouped = artifacts.filter(
    (a) => a.folderId === null || !knownFolderIds.has(a.folderId),
  );
  if (ungrouped.length > 0 || includeEmptyUngrouped)
    groups.push({ key: UNGROUPED_KEY, folder: null, artifacts: ungrouped });

  return groups;
}
