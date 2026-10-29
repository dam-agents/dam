import type { GitHubUserTokenScope } from "api-server-api";
import { useEffect, useState } from "react";

import { useProbeGitHubUserToken } from "../api/mutations.js";
import type { GithubAccess } from "../lib/github-access.js";
import { splitUnlistedRepos } from "../lib/github-app-scope-fields.js";
import { userTokenScopeChoice } from "../lib/github-user-token-scope.js";
import { useGithubScopeSelection } from "./use-github-scope-selection.js";

// UNIT_BOUNDARY_DESCRIPTION: what a GitHub sign-in connection is about to reach, while a dialog edits it: full access, or one account with its repositories and permissions read from the sign-in's app installations. The probe takes a sign-in or a connection made from it, since the server reads both with the sign-in's token. The choice is null until it is complete, so Save stays off.
export function useGithubUserTokenScopeDraft(
  connectionId: string,
  current: { scope?: GitHubUserTokenScope; fullAccess?: boolean },
) {
  const probe = useProbeGitHubUserToken();
  const scope = useGithubScopeSelection(current.scope ?? null);
  const [access, setAccess] = useState<GithubAccess>(
    current.fullAccess ? "full" : "narrowed",
  );
  const [targetId, setTargetId] = useState<number | null>(
    current.scope?.targetId ?? null,
  );

  const { mutate: runProbe } = probe;
  useEffect(() => {
    runProbe({ connectionId });
  }, [runProbe, connectionId]);

  const installations = probe.data?.installations ?? [];
  const chosen = installations.find((i) => i.targetId === targetId);
  const chosenMissing =
    probe.data !== undefined && targetId !== null && !chosen;
  const unlisted = chosen
    ? splitUnlistedRepos(scope.repoIds, chosen)
    : { saved: [...scope.repoIds], kept: 0, dropped: 0 };

  const chooseAccount = (next: number) => {
    if (next === targetId) return;
    scope.reset();
    setTargetId(next);
  };

  const choice = userTokenScopeChoice({
    access,
    targetId: chosen ? targetId : null,
    repositoryIds: new Set(unlisted.saved),
    permissions: scope.permissions,
  });

  return {
    probe,
    installations,
    chosen,
    chosenMissing,
    unlistedRepoCount: unlisted.kept,
    droppedRepoCount: unlisted.dropped,
    targetId,
    targetLogin: current.scope?.targetLogin,
    chooseAccount,
    scope,
    access,
    setAccess,
    choice,
  };
}

export type GithubUserTokenScopeDraft = ReturnType<
  typeof useGithubUserTokenScopeDraft
>;
