import { WORKSPACE_REFUSED_MESSAGE } from "api-server-api";

import { switchWorkspace } from "./current-workspace.js";

export function isWorkspaceRefusedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === WORKSPACE_REFUSED_MESSAGE &&
    "data" in error &&
    (error as { data?: { code?: string } }).data?.code === "FORBIDDEN"
  );
}

export function onWorkspaceRefused(): void {
  switchWorkspace(null);
}
