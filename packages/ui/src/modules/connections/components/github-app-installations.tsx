import { Enterprise, Information, User, WarningAlt } from "@carbon/icons-react";
import type {
  ConnectionView,
  GitHubAppInstallationAccount,
} from "api-server-api";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { DisclosureToggle } from "@/components/ui/disclosure";
import { cn } from "@/lib/utils";

import { useGitHubAppInstallations } from "../api/queries.js";
import {
  installationsCountLabel,
  isGithubSignInTemplate,
  sizedAvatarUrl,
} from "../lib/github-installations.js";
import {
  activeInstallUrl,
  GithubAppInstallLink,
  INSTALL_REACH,
} from "./github-app-install-hint.js";

const AVATARS_SHOWN = 5;

type InstallationsConnection = Pick<
  ConnectionView,
  "id" | "templateId" | "host" | "appSlug" | "status" | "parentId"
>;

const LINE =
  "mt-1 flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground";

// UNIT_BOUNDARY_DESCRIPTION: the accounts a GitHub sign-in's app is installed on, under the sign-in's row: their avatars and a count that opens the list, each flagged only when suspended, or one plain line with the install link while the app is installed nowhere, so the user sees whether the account they need is covered before an agent fails on it.
export function GithubAppInstallations({
  connection,
}: {
  connection: InstallationsConnection;
}) {
  const installUrl = isGithubSignInTemplate(connection.templateId)
    ? activeInstallUrl(connection)
    : null;
  const installations = useGitHubAppInstallations(
    connection.id,
    installUrl !== null,
  );
  const [open, setOpen] = useState(false);
  if (installUrl === null) return null;
  const testId = `github-installations-${connection.id}`;
  if (installations.isPending)
    return (
      <p className={LINE} data-testid={testId}>
        Checking where the app is installed…
      </p>
    );
  if (installations.isError)
    return (
      <p className={LINE} data-testid={testId}>
        <WarningAlt
          size={12}
          aria-hidden
          className="mt-0.5 shrink-0 text-warning"
        />
        <span className="min-w-0">
          Couldn&apos;t check where the app is installed.{" "}
          <GithubAppInstallLink url={installUrl} testId={`${testId}-install`}>
            Install the app
          </GithubAppInstallLink>
        </span>
      </p>
    );
  const { accounts } = installations.data;
  if (accounts.length === 0)
    return (
      <p className={LINE} data-testid={testId}>
        <Information size={12} aria-hidden className="mt-0.5 shrink-0" />
        <span className="min-w-0">
          Installed on no account yet.{" "}
          <GithubAppInstallLink url={installUrl} testId={`${testId}-install`}>
            Install the app
          </GithubAppInstallLink>{" "}
          {INSTALL_REACH}.
        </span>
      </p>
    );
  const hidden = accounts.length - AVATARS_SHOWN;
  return (
    <div className="mt-1 text-xs" data-testid={testId}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <DisclosureToggle
          open={open}
          onToggle={() => setOpen(!open)}
          chevronSize={12}
          testId={`${testId}-toggle`}
          className="min-w-0 max-w-full flex-wrap gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <span className="flex shrink-0 items-center gap-0.5">
            {accounts.slice(0, AVATARS_SHOWN).map((account) => (
              <AccountAvatar key={account.targetId} account={account} />
            ))}
            {hidden > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-muted px-1 text-[10px] font-medium text-muted-foreground">
                +{hidden}
              </span>
            )}
          </span>
          <span className="min-w-0">
            Installed on {installationsCountLabel(installations.data)}
          </span>
        </DisclosureToggle>
        <GithubAppInstallLink url={installUrl} testId={`${testId}-install`}>
          Install on another account
        </GithubAppInstallLink>
      </div>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1.5 pl-5">
          {accounts.map((account) => (
            <li
              key={account.targetId}
              className="flex min-w-0 items-center gap-2"
              data-testid={`${testId}-account-${account.login}`}
            >
              <AccountAvatar account={account} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="break-words font-medium text-foreground">
                  {account.login}
                </span>
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground">
                  {account.kind === "user" ? "Personal account · " : ""}
                  {account.repositorySelection === "all"
                    ? "All repositories"
                    : "Selected repositories"}
                  {account.suspended && (
                    <Badge size="sm" variant="warning" className="shrink-0">
                      Suspended
                    </Badge>
                  )}
                </span>
              </span>
            </li>
          ))}
          {installations.data.truncated && (
            <li className="text-muted-foreground">
              And more GitHub does not list here.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

const AVATAR_PX = 20;

function AccountAvatar({ account }: { account: GitHubAppInstallationAccount }) {
  const [failed, setFailed] = useState(false);
  const shape = cn(
    "size-5 shrink-0 bg-muted",
    account.kind === "organization" ? "rounded-[4px]" : "rounded-full",
  );
  if (account.avatarUrl && !failed)
    return (
      <img
        src={sizedAvatarUrl(account.avatarUrl, AVATAR_PX * 2)}
        alt=""
        title={account.login}
        width={AVATAR_PX}
        height={AVATAR_PX}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={shape}
      />
    );
  const Icon = account.kind === "organization" ? Enterprise : User;
  return (
    <span
      title={account.login}
      className={cn(
        shape,
        "inline-flex items-center justify-center text-muted-foreground",
      )}
    >
      <Icon size={14} aria-hidden />
    </span>
  );
}
