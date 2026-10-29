import { Callout } from "@/components/ui/callout";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import type { GithubUserTokenScopeDraft } from "../hooks/use-github-user-token-scope-draft.js";
import { GithubScopeFields } from "./github-app-scope-sections.js";

export function GithubUserTokenScopeFields({
  draft,
}: {
  draft: GithubUserTokenScopeDraft;
}) {
  const { probe, installations, chosen, targetId, scope, unlistedRepoCount } =
    draft;
  if (probe.isPending)
    return (
      <p className="text-sm text-muted-foreground">
        Reading what this GitHub sign-in can reach…
      </p>
    );
  if (probe.isError)
    return (
      <Callout tone="danger" size="sm">
        Couldn&rsquo;t read this sign-in&rsquo;s app installations:{" "}
        {probe.error.message}
      </Callout>
    );
  if (!probe.data) return null;
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Account</legend>
        <p className="text-sm text-muted-foreground">
          The connection reaches one account. Your own access on each repository
          still applies — the token never does more than you can.
        </p>
        {installations.length === 0 ? (
          <Callout tone="muted" size="sm">
            The app is not installed on any account you can reach yet. Install
            it, then come back.
          </Callout>
        ) : (
          <RadioGroup
            value={targetId === null ? "" : String(targetId)}
            onValueChange={(value) => draft.chooseAccount(Number(value))}
            aria-label="Account to narrow to"
          >
            {installations.map((inst) => (
              <RadioGroupItem
                key={inst.targetId}
                value={String(inst.targetId)}
                label={inst.accountLogin}
                testId={`github-user-account-${inst.accountLogin}`}
              />
            ))}
          </RadioGroup>
        )}
        {probe.data.installationsTruncated && (
          <Callout tone="muted" size="sm">
            This sign-in reaches more app installations than can be listed here.
          </Callout>
        )}
      </fieldset>
      {draft.chosenMissing && (
        <Callout tone="danger" size="sm">
          This connection is narrowed to {draft.targetLogin ?? "an account"}{" "}
          that the app is no longer installed on for you. Choose another
          account, or full access.
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
          dropped={draft.droppedRepoCount}
        />
      )}
    </>
  );
}
