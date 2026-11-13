import type { ChangeSet } from "../types.js";

export interface ChangeSetSelection {
  path: string | null;
  seenEditTimes: Record<string, string>;
}

export function initialSelection(changeSets: ChangeSet[]): ChangeSetSelection {
  const first =
    changeSets.find((cs) => cs.sessionEditedAt !== null) ?? changeSets[0];
  return {
    path: first?.path ?? null,
    seenEditTimes: Object.fromEntries(
      changeSets
        .filter((cs) => cs.sessionEditedAt !== null)
        .map((cs) => [cs.path, cs.sessionEditedAt!]),
    ),
  };
}

export function choose(
  selection: ChangeSetSelection,
  path: string,
  changeSets: ChangeSet[],
): ChangeSetSelection {
  const cs = changeSets.find((c) => c.path === path);
  const seenEditTimes = { ...selection.seenEditTimes };
  if (cs?.sessionEditedAt) {
    seenEditTimes[path] = cs.sessionEditedAt;
  }
  return { path, seenEditTimes };
}
