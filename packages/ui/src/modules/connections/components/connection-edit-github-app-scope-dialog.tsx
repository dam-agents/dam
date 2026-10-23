import type { ConnectionView } from "api-server-api";
import { useEffect, useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Callout } from "@/components/ui/callout";

import {
  useProbeGitHubAppInstallationForConnection,
  useUpdateGitHubAppScope,
} from "../api/mutations.js";
import { GithubScopeFields } from "../forms/github-app-scope-sections.js";
import { useGithubScopeSelection } from "../hooks/use-github-scope-selection.js";
import {
  writePermissions,
  writeRepositoryIds,
} from "../lib/github-app-scope-fields.js";
import { mutationMessage } from "../lib/mutation-message.js";

export function ConnectionEditGithubAppScopeDialog({
  connection,
  onClose,
}: {
  connection: ConnectionView;
  onClose: () => void;
}) {
  const probe = useProbeGitHubAppInstallationForConnection();
  const save = useUpdateGitHubAppScope();
  const installation = probe.data;
  const scope = useGithubScopeSelection(connection.githubAppScope ?? null);

  const [unresolvedNames, setUnresolvedNames] = useState<string[]>([]);

  const { mutate: runProbe } = probe;
  const { setRepoIds } = scope;
  useEffect(() => {
    runProbe(
      { connectionId: connection.id },
      {
        onSuccess: (result) => {
          const names = connection.githubAppScope?.repositories ?? [];
          if (names.length === 0) return;
          const byName = new Map(
            result.repositories.map((r) => [r.name, r.id] as const),
          );
          const resolved: number[] = [];
          const missing: string[] = [];
          for (const name of names) {
            const id = byName.get(name);
            if (id === undefined) missing.push(name);
            else resolved.push(id);
          }
          setRepoIds((prev) => new Set([...prev, ...resolved]));
          setUnresolvedNames(missing);
        },
      },
    );
  }, [
    runProbe,
    connection.id,
    connection.githubAppScope?.repositories,
    setRepoIds,
  ]);

  const saveError = mutationMessage(
    save.error,
    "Couldn't update the scope. Please try again.",
  );

  const namesToResolve = (connection.githubAppScope?.repositories ?? []).length;
  const repositoriesLocked =
    Boolean(installation?.repositoriesUnavailable) ||
    Boolean(installation?.repositoriesTruncated && namesToResolve > 0);

  const repositoryPayload = repositoriesLocked
    ? {
        repositoryIds: writeRepositoryIds(
          connection.githubAppScope?.repositoryIds ?? [],
        ),
        repositories: (connection.githubAppScope?.repositories ?? []).join(" "),
      }
    : { repositoryIds: writeRepositoryIds([...scope.repoIds]) };

  const submit = async () => {
    try {
      await save.mutateAsync({
        id: connection.id,
        ...repositoryPayload,
        permissions: writePermissions(scope.permissions),
      });
      onClose();
    } catch {}
  };

  const keptUnlisted = installation
    ? [...scope.repoIds].filter(
        (id) => !installation.repositories.some((r) => r.id === id),
      ).length
    : 0;

  const narrowedRepos = repositoriesLocked
    ? (connection.githubAppScope?.repositoryIds?.length ?? 0) +
      (connection.githubAppScope?.repositories?.length ?? 0)
    : scope.repoIds.size;
  const narrowed =
    narrowedRepos > 0 || Object.keys(scope.permissions).length > 0;

  return (
    <Modal onClose={save.isPending ? undefined : onClose}>
      <DialogHeader
        title="Edit repositories & permissions"
        subtitle={connection.name}
        onClose={onClose}
        closeTestId="edit-scope-close"
      />
      <DialogBody className="flex flex-col gap-4">
        {probe.isPending && (
          <p className="text-sm text-muted-foreground">
            Reading the installation…
          </p>
        )}
        {probe.isError && (
          <Callout tone="danger" size="sm">
            Couldn&rsquo;t read this installation: {probe.error.message}
          </Callout>
        )}
        {installation && (
          <GithubScopeFields
            installation={installation}
            selection={scope}
            locked={
              repositoriesLocked
                ? {
                    note: installation.repositoriesUnavailable
                      ? "Couldn’t list this installation’s repositories, so they can’t be changed here"
                      : "This installation has more repositories than can be listed here, and this connection names them individually, so they can’t be changed here",
                    saving:
                      "saving keeps the ones this connection already uses. Permissions below are still the installation’s own.",
                  }
                : undefined
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
          >
            {!repositoriesLocked && unresolvedNames.length > 0 && (
              <Callout tone="danger" size="sm">
                This connection also names {unresolvedNames.join(", ")}, which
                the installation no longer lists. Saving will drop{" "}
                {unresolvedNames.length === 1 ? "it" : "them"}.
              </Callout>
            )}
            {!narrowed && (
              <Callout tone="danger" size="sm">
                Nothing selected — saving gives this connection everything the
                app installation can do.
              </Callout>
            )}
          </GithubScopeFields>
        )}
        {saveError && (
          <Callout tone="danger" size="sm">
            {saveError}
          </Callout>
        )}
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelDisabled={save.isPending}
        label="Save"
        pendingLabel="Saving…"
        pending={save.isPending}
        disabled={!installation}
        onSubmit={() => void submit()}
        testId="edit-scope-submit"
      />
    </Modal>
  );
}
