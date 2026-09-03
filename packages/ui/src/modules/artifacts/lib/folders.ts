import type { ArtifactFolder } from "api-server-api";
import { EXPERIMENT_FOLDER_PREFIX } from "api-server-api";

export function isExperimentFolder(folder: ArtifactFolder): boolean {
  return folder.name.startsWith(EXPERIMENT_FOLDER_PREFIX);
}

export function isUserFolder(folder: ArtifactFolder): boolean {
  return !isExperimentFolder(folder);
}

export function folderDisplayName(folder: ArtifactFolder): string {
  return isExperimentFolder(folder)
    ? folder.name.slice(EXPERIMENT_FOLDER_PREFIX.length)
    : folder.name;
}

export function folderDisplayNames(
  folders: readonly ArtifactFolder[],
): Map<string, string> {
  const stripped = new Map(
    folders.map((folder) => [folder.id, folderDisplayName(folder)]),
  );
  const counts = new Map<string, number>();
  for (const name of stripped.values()) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const names = new Map<string, string>();
  for (const folder of folders) {
    const name = stripped.get(folder.id)!;
    names.set(folder.id, (counts.get(name) ?? 0) > 1 ? folder.name : name);
  }
  return names;
}
