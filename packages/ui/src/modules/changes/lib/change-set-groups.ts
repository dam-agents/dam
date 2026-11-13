import type { ChangeSet } from "../types.js";

export interface ChangeSetGroup {
  key: string;
  label: string;
  changeSets: ChangeSet[];
}

function changeSetLabel(cs: ChangeSet): string {
  const name = cs.repository.name;
  const branch = cs.branch ?? "detached";
  return cs.path === cs.repository.root
    ? `${name} · ${branch}`
    : `${name} (${cs.path.split("/").pop()}) · ${branch}`;
}

export function groupChangeSets(
  changeSets: ChangeSet[],
  sessionId?: string,
): ChangeSetGroup[] {
  const session: ChangeSet[] = [];
  const changed: ChangeSet[] = [];
  const clean: ChangeSet[] = [];

  for (const cs of changeSets) {
    if (cs.sessionEditedAt) {
      session.push(cs);
    } else if (cs.stat.files > 0 || cs.uncommitted) {
      changed.push(cs);
    } else {
      clean.push(cs);
    }
  }

  const groups: ChangeSetGroup[] = [];
  if (session.length > 0) {
    groups.push({
      key: "session",
      label: "Changed in this session",
      changeSets: session,
    });
  }
  if (changed.length > 0) {
    groups.push({
      key: "changed",
      label: "Other repos with changes",
      changeSets: changed,
    });
  }
  if (clean.length > 0) {
    groups.push({ key: "clean", label: "Clean", changeSets: clean });
  }
  return groups;
}

export { changeSetLabel };

export function hasNewChanges(
  changeSets: ChangeSet[],
  selectedPath: string | null,
): boolean {
  return changeSets.some(
    (cs) => cs.sessionEditedAt !== null && cs.path !== selectedPath,
  );
}
