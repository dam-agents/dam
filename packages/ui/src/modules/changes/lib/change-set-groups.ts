import type { ChangeSet } from "agent-runtime-api";

export type ChangeSetGroupId = "session" | "changed" | "clean";

export interface ChangeSetGroup {
  id: ChangeSetGroupId;
  label: string;
  changeSets: ChangeSet[];
}

const GROUP_LABELS: Record<ChangeSetGroupId, string> = {
  session: "Changed in this session",
  changed: "Other repositories with changes",
  clean: "Clean",
};

export function hasChanges(changeSet: ChangeSet): boolean {
  return (
    changeSet.readError !== null ||
    changeSet.uncommitted ||
    changeSet.commitsAhead > 0 ||
    changeSet.stat.files > 0
  );
}

function newestEditFirst(a: ChangeSet, b: ChangeSet): number {
  const left = a.sessionEditedAt ?? "";
  const right = b.sessionEditedAt ?? "";
  return left < right ? 1 : left > right ? -1 : 0;
}

export function changeSetLabel(changeSet: ChangeSet): string {
  return changeSet.branch
    ? `${changeSet.repository.name} · ${changeSet.branch}`
    : `${changeSet.repository.name} · detached`;
}

function matches(changeSet: ChangeSet, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return [changeSet.repository.name, changeSet.branch ?? "", changeSet.path]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function groupChangeSets(
  changeSets: readonly ChangeSet[],
  filter = "",
): ChangeSetGroup[] {
  const shown = changeSets.filter((changeSet) => matches(changeSet, filter));
  const session = shown
    .filter((changeSet) => changeSet.sessionEditedAt !== null)
    .sort(newestEditFirst);
  const rest = shown.filter((changeSet) => changeSet.sessionEditedAt === null);
  const groups: ChangeSetGroup[] = [
    { id: "session", label: GROUP_LABELS.session, changeSets: session },
    {
      id: "changed",
      label: GROUP_LABELS.changed,
      changeSets: rest.filter(hasChanges),
    },
    {
      id: "clean",
      label: GROUP_LABELS.clean,
      changeSets: rest.filter((changeSet) => !hasChanges(changeSet)),
    },
  ];
  return groups.filter((group) => group.changeSets.length > 0);
}

export function lastEditedChangeSet(
  changeSets: readonly ChangeSet[],
): ChangeSet | null {
  return (
    changeSets
      .filter((changeSet) => changeSet.sessionEditedAt !== null)
      .sort(newestEditFirst)[0] ?? null
  );
}

export type SeenEdits = Readonly<Record<string, string>>;

export function seenNow(changeSets: readonly ChangeSet[]): SeenEdits {
  return Object.fromEntries(
    changeSets.flatMap((changeSet) =>
      changeSet.sessionEditedAt
        ? [[changeSet.path, changeSet.sessionEditedAt]]
        : [],
    ),
  );
}

export function hasNewChanges(
  changeSet: ChangeSet,
  seen: SeenEdits,
  selectedPath: string | null,
): boolean {
  if (changeSet.path === selectedPath || !changeSet.sessionEditedAt)
    return false;
  const seenAt = seen[changeSet.path];
  return seenAt === undefined || changeSet.sessionEditedAt > seenAt;
}
