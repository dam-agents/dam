import {
  browserStorage,
  safeGetItem,
  safeRemoveItem,
  safeSetItem,
} from "../../../lib/safe-storage.js";

const WORKSPACE_STORAGE_KEY = "platform-workspace";

export function currentWorkspaceId(): string | null {
  return safeGetItem(browserStorage, WORKSPACE_STORAGE_KEY);
}

export function switchWorkspace(id: string | null): void {
  if (id === currentWorkspaceId()) return;
  if (id === null) safeRemoveItem(browserStorage, WORKSPACE_STORAGE_KEY);
  else safeSetItem(browserStorage, WORKSPACE_STORAGE_KEY, id);
  location.assign("/");
}
