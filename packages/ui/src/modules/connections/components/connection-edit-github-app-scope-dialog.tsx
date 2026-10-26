import { TRPCClientError } from "@trpc/client";
import type { ConnectionView } from "api-server-api";
import { useEffect, useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import {
  useProbeGitHubAppInstallationForConnection,
  useUpdateGitHubAppScope,
} from "../api/mutations.js";
import {
  PermissionSection,
  RepositorySection,
} from "../forms/github-app-scope-sections.js";
import {
  type PermissionLevel,
  writePermissions,
  writeRepositoryIds,
} from "../lib/github-app-scope-fields.js";

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

  const [repoIds, setRepoIds] = useState<Set<number>>(
    () => new Set(connection.githubAppScope?.repositoryIds ?? []),
  );
  const [permissions, setPermissions] = useState<
    Record<string, PermissionLevel>
  >(
    () =>
      (connection.githubAppScope?.permissions ?? {}) as Record<
        string,
        PermissionLevel
      >,
  );

  const [unresolvedNames, setUnresolvedNames] = useState<string[]>([]);

  const { mutate: runProbe } = probe;
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
  }, [runProbe, connection.id, connection.githubAppScope?.repositories]);

  const toggleRepo = (id: number, checked: boolean) => {
    setRepoIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const setPermission = (name: string, level: PermissionLevel | "off") => {
    setPermissions((prev) => {
      const next = { ...prev };
      if (level === "off") delete next[name];
      else next[name] = level;
      return next;
    });
  };

  const saveError =
    save.error === null
      ? undefined
      : isBadRequest(save.error)
        ? save.error.message
        : "Couldn't update the scope. Please try again.";

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
    : { repositoryIds: writeRepositoryIds([...repoIds]) };

  const submit = async () => {
    try {
      await save.mutateAsync({
        id: connection.id,
        ...repositoryPayload,
        permissions: writePermissions(permissions),
      });
      onClose();
    } catch {}
  };

  const keptUnlisted = installation
    ? [...repoIds].filter(
        (id) => !installation.repositories.some((r) => r.id === id),
      ).length
    : 0;

  const narrowedRepos = repositoriesLocked
    ? (connection.githubAppScope?.repositoryIds?.length ?? 0) +
      (connection.githubAppScope?.repositories?.length ?? 0)
    : repoIds.size;
  const narrowed = narrowedRepos > 0 || Object.keys(permissions).length > 0;

  return (
    <Modal widthClass="w-[560px]">
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
          <>
            {repositoriesLocked ? (
              <Callout tone="muted" size="sm">
                {installation.repositoriesUnavailable
                  ? "Couldn’t list this installation’s repositories, so they can’t be changed here"
                  : "This installation has more repositories than can be listed here, and this connection names them individually, so they can’t be changed here"}
                {" — saving keeps the ones this connection already uses. "}
                Permissions below are still the installation&rsquo;s own.
              </Callout>
            ) : (
              <>
                <RepositorySection
                  installation={installation}
                  selected={repoIds}
                  onToggle={toggleRepo}
                />
                {keptUnlisted > 0 && (
                  <Callout tone="muted" size="sm">
                    {keptUnlisted} selected{" "}
                    {keptUnlisted === 1 ? "repository is" : "repositories are"}{" "}
                    not in the list above
                    {installation.repositoriesTruncated
                      ? " (it shows only the first page of a large installation)"
                      : ""}
                    . They stay selected when you save.
                  </Callout>
                )}
              </>
            )}
            <PermissionSection
              installation={installation}
              selection={permissions}
              onChange={setPermission}
            />
            {}
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
          </>
        )}
        {saveError && (
          <Callout tone="danger" size="sm">
            {saveError}
          </Callout>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!installation || save.isPending}
          onClick={() => void submit()}
          data-testid="edit-scope-submit"
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}

function isBadRequest(err: unknown): err is Error {
  return err instanceof TRPCClientError && err.data?.code === "BAD_REQUEST";
}
