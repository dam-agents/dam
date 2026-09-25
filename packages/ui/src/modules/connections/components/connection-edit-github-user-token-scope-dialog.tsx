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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import {
  useProbeGitHubUserToken,
  useUpdateGitHubUserTokenScope,
} from "../api/mutations.js";
import {
  PermissionSection,
  RepositorySection,
} from "../forms/github-app-scope-sections.js";
import type { PermissionLevel } from "../lib/github-app-scope-fields.js";
import {
  EVERY_ACCOUNT,
  userTokenScopePayload,
} from "../lib/github-user-token-scope.js";

export function ConnectionEditGithubUserTokenScopeDialog({
  connection,
  onClose,
}: {
  connection: ConnectionView;
  onClose: () => void;
}) {
  const probe = useProbeGitHubUserToken();
  const save = useUpdateGitHubUserTokenScope();
  const current = connection.githubUserToken?.scope;

  const [targetId, setTargetId] = useState<number | null>(
    current?.targetId ?? null,
  );
  const [repoIds, setRepoIds] = useState<Set<number>>(
    () => new Set(current?.repositoryIds ?? []),
  );
  const [permissions, setPermissions] = useState<
    Record<string, PermissionLevel>
  >(() => (current?.permissions ?? {}) as Record<string, PermissionLevel>);

  const { mutate: runProbe } = probe;
  useEffect(() => {
    runProbe({ connectionId: connection.id });
  }, [runProbe, connection.id]);

  const installations = probe.data?.installations ?? [];
  const chosen = installations.find((i) => i.targetId === targetId);
  const chosenMissing =
    probe.data !== undefined && targetId !== null && !chosen;

  const chooseAccount = (value: string) => {
    const next = value === EVERY_ACCOUNT ? null : Number(value);
    if (next === targetId) return;
    setRepoIds(new Set());
    setPermissions({});
    setTargetId(next);
  };

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

  const submit = async () => {
    try {
      await save.mutateAsync(
        userTokenScopePayload(connection.id, {
          targetId,
          repositoryIds: repoIds,
          permissions,
        }),
      );
      onClose();
    } catch {}
  };

  return (
    <Modal widthClass="w-[560px]">
      <DialogHeader
        title="Edit repositories & permissions"
        subtitle={connection.name}
        onClose={onClose}
        closeTestId="edit-user-scope-close"
      />
      <DialogBody className="flex flex-col gap-4">
        {probe.isPending && (
          <p className="text-sm text-muted-foreground">
            Reading what this GitHub sign-in can reach…
          </p>
        )}
        {probe.isError && (
          <Callout tone="danger" size="sm">
            Couldn&rsquo;t read this sign-in&rsquo;s app installations:{" "}
            {probe.error.message}
          </Callout>
        )}
        {probe.data && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Account</legend>
              <p className="text-xs text-muted-foreground">
                A narrowed token reaches one account. Your own access on each
                repository still applies — the token never does more than you
                can.
              </p>
              <RadioGroup
                value={targetId === null ? EVERY_ACCOUNT : String(targetId)}
                onValueChange={chooseAccount}
                aria-label="Account to narrow to"
              >
                <RadioGroupItem
                  value={EVERY_ACCOUNT}
                  label="Every account (not narrowed)"
                  testId="github-user-account-every"
                />
                {installations.map((inst) => (
                  <RadioGroupItem
                    key={inst.targetId}
                    value={String(inst.targetId)}
                    label={inst.accountLogin}
                    testId={`github-user-account-${inst.accountLogin}`}
                  />
                ))}
              </RadioGroup>
              {probe.data.installationsTruncated && (
                <Callout tone="muted" size="sm">
                  This sign-in reaches more app installations than can be listed
                  here.
                </Callout>
              )}
            </fieldset>
            {chosenMissing && (
              <Callout tone="danger" size="sm">
                This connection is narrowed to{" "}
                {current?.targetLogin ?? "an account"} that the app is no longer
                installed on for you. Choose another account, or none.
              </Callout>
            )}
            {chosen && (
              <>
                {chosen.repositoriesUnavailable ? (
                  <Callout tone="muted" size="sm">
                    Couldn&rsquo;t list this account&rsquo;s repositories, so
                    saving narrows to the account and permissions only.
                  </Callout>
                ) : (
                  <RepositorySection
                    installation={chosen}
                    selected={repoIds}
                    onToggle={toggleRepo}
                  />
                )}
                <PermissionSection
                  installation={chosen}
                  selection={permissions}
                  onChange={setPermission}
                />
              </>
            )}
            {targetId === null && (
              <Callout tone="danger" size="sm">
                Not narrowed — saving gives this connection everything this
                GitHub sign-in can reach through the app, on every account.
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
          disabled={!probe.data || chosenMissing || save.isPending}
          onClick={() => void submit()}
          data-testid="edit-user-scope-submit"
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
