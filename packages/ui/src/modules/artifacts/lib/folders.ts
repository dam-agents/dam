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
