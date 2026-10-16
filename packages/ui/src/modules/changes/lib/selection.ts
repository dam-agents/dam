import type { ChangeSet } from "agent-runtime-api";

import {
  lastEditedChangeSet,
  type SeenEdits,
  seenNow,
} from "./change-set-groups.js";

export interface ChangeSetSelection {
  path: string | null;
  seen: SeenEdits;
}

export function initialSelection(
  changeSets: readonly ChangeSet[],
): ChangeSetSelection {
  return {
    path: lastEditedChangeSet(changeSets)?.path ?? null,
    seen: seenNow(changeSets),
  };
}

function markSeen(
  seen: SeenEdits,
  changeSets: readonly ChangeSet[],
  path: string | null,
): SeenEdits {
  const editedAt = changeSets.find((c) => c.path === path)?.sessionEditedAt;
  return path && editedAt ? { ...seen, [path]: editedAt } : seen;
}

export function choose(
  selection: ChangeSetSelection,
  changeSets: readonly ChangeSet[],
  path: string | null,
): ChangeSetSelection {
  const left = markSeen(selection.seen, changeSets, selection.path);
  return { path, seen: markSeen(left, changeSets, path) };
}
