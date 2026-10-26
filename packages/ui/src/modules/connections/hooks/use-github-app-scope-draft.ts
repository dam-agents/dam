import type { ConnectionView } from "api-server-api";
import { useEffect, useState } from "react";

import { useProbeGitHubAppInstallationForConnection } from "../api/mutations.js";
import type { GithubAccess } from "../lib/github-access.js";
import { appScopeChoice } from "../lib/github-app-scope-fields.js";
import { useGithubScopeSelection } from "./use-github-scope-selection.js";

type AppScope = NonNullable<ConnectionView["githubAppScope"]>;

const NO_NAMES: readonly string[] = [];

// UNIT_BOUNDARY_DESCRIPTION: what a GitHub App installation connection is about to reach, while a dialog edits it: full access, or the repositories and permissions read from the installation. Repository names the connection already holds are matched to the listing's ids; when the listing cannot show them all, the names and ids the connection holds are kept as they are. The choice is null until at least one repository or permission is chosen, so Save stays off.
export function useGithubAppScopeDraft(
  connectionId: string,
  current: { scope?: AppScope; fullAccess?: boolean },
) {
  const probe = useProbeGitHubAppInstallationForConnection();
  const installation = probe.data;
  const scope = useGithubScopeSelection(current.scope ?? null);
  const [access, setAccess] = useState<GithubAccess>(
    current.fullAccess ? "full" : "narrowed",
  );
  const [unresolvedNames, setUnresolvedNames] = useState<string[]>([]);
  const heldNames = current.scope?.repositories ?? NO_NAMES;

  const { mutate: runProbe } = probe;
  const { setRepoIds } = scope;
  useEffect(() => {
    runProbe(
      { connectionId },
      {
        onSuccess: (result) => {
          if (heldNames.length === 0) return;
          const byName = new Map(
            result.repositories.map((r) => [r.name, r.id] as const),
          );
          const resolved: number[] = [];
          const missing: string[] = [];
          for (const name of heldNames) {
            const id = byName.get(name);
            if (id === undefined) missing.push(name);
            else resolved.push(id);
          }
          setRepoIds((prev) => new Set([...prev, ...resolved]));
          setUnresolvedNames(missing);
        },
      },
    );
  }, [runProbe, connectionId, heldNames, setRepoIds]);

  const repositoriesLocked =
    Boolean(installation?.repositoriesUnavailable) ||
    Boolean(installation?.repositoriesTruncated && heldNames.length > 0);

  const keptUnlisted = installation
    ? [...scope.repoIds].filter(
        (id) => !installation.repositories.some((r) => r.id === id),
      ).length
    : 0;

  const choice =
    access === "full" || installation
      ? appScopeChoice({
          access,
          repositories: repositoriesLocked ? heldNames : NO_NAMES,
          repositoryIds: repositoriesLocked
            ? (current.scope?.repositoryIds ?? [])
            : [...scope.repoIds],
          permissions: scope.permissions,
        })
      : null;

  return {
    probe,
    installation,
    scope,
    unresolvedNames,
    repositoriesLocked,
    keptUnlisted,
    access,
    setAccess,
    choice,
  };
}

export type GithubAppScopeDraft = ReturnType<typeof useGithubAppScopeDraft>;
