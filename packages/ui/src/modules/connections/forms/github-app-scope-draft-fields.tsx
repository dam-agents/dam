import type { GitHubAppInstallationProbe } from "api-server-api";
import { match } from "ts-pattern";

import { Callout } from "@/components/ui/callout";

import type { GithubAppScopeDraft } from "../hooks/use-github-app-scope-draft.js";
import { NO_APP_SCOPE } from "../lib/github-app-scope-fields.js";
import { GithubScopeFields } from "./github-app-scope-sections.js";

type Purpose = "new" | "edit";

function lockedCopy(
  purpose: Purpose,
  installation: GitHubAppInstallationProbe,
): { note: string; saving: string } {
  return match(purpose)
    .with("new", () => ({
      note: "Couldn’t list this installation’s repositories, so they can’t be chosen here",
      saving:
        "the connection reaches every repository the installation can reach, with the permissions you choose below.",
    }))
    .with("edit", () => ({
      note: installation.repositoriesUnavailable
        ? "Couldn’t list this installation’s repositories, so they can’t be changed here"
        : "This installation has more repositories than can be listed here, and this connection names them individually, so they can’t be changed here",
      saving:
        "saving keeps the ones this connection already uses. Permissions below are still the installation’s own.",
    }))
    .exhaustive();
}

export function GithubAppScopeDraftFields({
  draft,
  purpose,
}: {
  draft: GithubAppScopeDraft;
  purpose: Purpose;
}) {
  const { probe, installation, repositoriesLocked, keptUnlisted } = draft;
  if (probe.isPending)
    return (
      <p className="text-sm text-muted-foreground">Reading the installation…</p>
    );
  if (probe.isError)
    return (
      <Callout tone="danger" size="sm">
        Couldn&rsquo;t read this installation: {probe.error.message}
      </Callout>
    );
  if (!installation) return null;
  return (
    <GithubScopeFields
      installation={installation}
      selection={draft.scope}
      locked={
        repositoriesLocked ? lockedCopy(purpose, installation) : undefined
      }
      unlisted={
        keptUnlisted > 0
          ? {
              count: keptUnlisted,
              note: installation.repositoriesTruncated
                ? " (it shows only the first page of a large installation)"
                : "",
            }
          : undefined
      }
      dropped={draft.droppedUnlisted}
    >
      {!repositoriesLocked && draft.unresolvedNames.length > 0 && (
        <Callout tone="danger" size="sm">
          This connection also names {draft.unresolvedNames.join(", ")}, which
          the installation no longer lists. Saving will drop{" "}
          {draft.unresolvedNames.length === 1 ? "it" : "them"}.
        </Callout>
      )}
      {draft.choice === null && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="github-app-scope-needed"
        >
          {NO_APP_SCOPE}
        </p>
      )}
    </GithubScopeFields>
  );
}
