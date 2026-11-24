import type { ArtifactVisibility } from "api-server-api";

import { err, ok, type Result } from "../../../core/result.js";

export interface ViewerAllowlistChange {
  viewers?: readonly string[];
  addViewers?: readonly string[];
  removeViewers?: readonly string[];
}

export type ViewerAllowlistRefusal =
  "replace-and-edit" | "added-and-removed" | "over-cap";

export function nextViewerAllowlist(
  existing: readonly string[],
  change: ViewerAllowlistChange,
  max: number,
): Result<string[] | undefined, ViewerAllowlistRefusal> {
  const added = change.addViewers ?? [];
  const removed = change.removeViewers ?? [];
  const edits =
    change.addViewers !== undefined || change.removeViewers !== undefined;
  if (change.viewers !== undefined && edits) return err("replace-and-edit");
  if (added.some((email) => removed.includes(email)))
    return err("added-and-removed");
  const next =
    change.viewers !== undefined
      ? [...change.viewers]
      : edits
        ? [
            ...existing.filter((email) => !removed.includes(email)),
            ...added.filter((email) => !existing.includes(email)),
          ]
        : undefined;
  if (next !== undefined && next.length > max) return err("over-cap");
  return ok(next);
}

export function widensInteractiveAudience(
  before: { interactive: boolean; visibility: ArtifactVisibility },
  visibility: ArtifactVisibility | undefined,
  existing: readonly string[],
  next: readonly string[] | undefined,
): boolean {
  if (!before.interactive) return false;
  const becomesRestricted =
    visibility === "restricted" && before.visibility !== "restricted";
  const addsViewer = (next ?? []).some((email) => !existing.includes(email));
  return becomesRestricted || addsViewer;
}
