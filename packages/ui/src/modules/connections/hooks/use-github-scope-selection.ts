import { useState } from "react";

import type { PermissionLevel } from "../lib/github-app-scope-fields.js";

interface Initial {
  repositoryIds?: readonly number[];
  permissions?: Record<string, string>;
}

// UNIT_BOUNDARY_DESCRIPTION: the repositories and permissions a GitHub scope dialog has ticked. Both the app-installation scope and the user-token scope edit the same pair, and reset clears it when the chosen account puts it on another installation. The wire carries the levels as plain strings; the server writes only the three levels, so they are read as such here.
export function useGithubScopeSelection(initial: Initial | null) {
  const [repoIds, setRepoIds] = useState<Set<number>>(
    () => new Set(initial?.repositoryIds ?? []),
  );
  const [permissions, setPermissions] = useState<
    Record<string, PermissionLevel>
  >(() => ({ ...initial?.permissions }) as Record<string, PermissionLevel>);

  function toggleRepo(id: number, checked: boolean) {
    setRepoIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setPermission(name: string, level: PermissionLevel | "off") {
    setPermissions((prev) => {
      const next = { ...prev };
      if (level === "off") delete next[name];
      else next[name] = level;
      return next;
    });
  }

  function reset() {
    setRepoIds(new Set());
    setPermissions({});
  }

  return { repoIds, setRepoIds, permissions, toggleRepo, setPermission, reset };
}
