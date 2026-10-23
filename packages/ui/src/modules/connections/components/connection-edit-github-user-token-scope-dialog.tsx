import type { ConnectionView } from "api-server-api";
import { useEffect, useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Callout } from "@/components/ui/callout";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import {
  useProbeGitHubUserToken,
  useUpdateGitHubUserTokenScope,
} from "../api/mutations.js";
import { GithubScopeFields } from "../forms/github-app-scope-sections.js";
import { useGithubScopeSelection } from "../hooks/use-github-scope-selection.js";
import {
  EVERY_ACCOUNT,
  userTokenScopePayload,
} from "../lib/github-user-token-scope.js";
import { mutationMessage } from "../lib/mutation-message.js";

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
  const scope = useGithubScopeSelection(current ?? null);

  const [targetId, setTargetId] = useState<number | null>(
    current?.targetId ?? null,
  );

  const { mutate: runProbe } = probe;
  useEffect(() => {
    runProbe({ connectionId: connection.id });
  }, [runProbe, connection.id]);

  const installations = probe.data?.installations ?? [];
  const chosen = installations.find((i) => i.targetId === targetId);
  const chosenMissing =
    probe.data !== undefined && targetId !== null && !chosen;
  const unlistedRepoCount = chosen
    ? [...scope.repoIds].filter(
        (id) => !chosen.repositories.some((r) => r.id === id),
      ).length
    : 0;

  const chooseAccount = (value: string) => {
    const next = value === EVERY_ACCOUNT ? null : Number(value);
    if (next === targetId) return;
    scope.reset();
    setTargetId(next);
  };

  const saveError = mutationMessage(
    save.error,
    "Couldn't update the scope. Please try again.",
  );

  const submit = async () => {
    try {
      await save.mutateAsync(
        userTokenScopePayload(connection.id, {
          targetId,
          repositoryIds: scope.repoIds,
          permissions: scope.permissions,
        }),
      );
      onClose();
    } catch {}
  };

  return (
    <Modal onClose={save.isPending ? undefined : onClose}>
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
              <p className="text-sm text-muted-foreground">
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
              <GithubScopeFields
                installation={chosen}
                selection={scope}
                locked={
                  chosen.repositoriesUnavailable
                    ? {
                        note: "Couldn’t list this account’s repositories, so they can’t be changed here",
                        saving:
                          unlistedRepoCount > 0
                            ? `saving keeps the ${unlistedRepoCount} this connection already uses.`
                            : "saving narrows to the account and permissions only.",
                      }
                    : undefined
                }
                unlisted={
                  unlistedRepoCount > 0
                    ? {
                        count: unlistedRepoCount,
                        note: chosen.repositoriesTruncated
                          ? " (it shows only the first pages of a large account)"
                          : "",
                      }
                    : undefined
                }
              />
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
      <DialogActions
        onCancel={onClose}
        cancelDisabled={save.isPending}
        label="Save"
        pendingLabel="Saving…"
        pending={save.isPending}
        disabled={!probe.data || chosenMissing}
        onSubmit={() => void submit()}
        testId="edit-user-scope-submit"
      />
    </Modal>
  );
}
