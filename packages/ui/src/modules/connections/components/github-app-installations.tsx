import { ChevronRight, Enterprise, User } from "@carbon/icons-react";
import type {
  ConnectionView,
  GitHubAppInstallationAccount,
  GitHubAppInstallations as Installations,
} from "api-server-api";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
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

type InstallationsConnection = Pick<
  ConnectionView,
  "id" | "templateId" | "host" | "appSlug" | "status" | "parentId"
>;

// UNIT_BOUNDARY_DESCRIPTION: the accounts a GitHub sign-in's app is installed on, on the header line of the sign-in's card after "Signed in with GitHub": the app and a count that opens the list of accounts below the line, a suspended one counted in the summary and flagged in the list, the install link for another account at the list's end; the same place says, with the install link, that the app is installed nowhere yet, and offers Try again before the install link when the list cannot be read, so the user sees whether the account they need is covered before an agent fails on it.
export function GithubAppInstallations({
  connection,
  appLabel,
}: {
  connection: InstallationsConnection;
  appLabel: string;
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
  const install = (text: string) => (
    <GithubAppInstallLink url={installUrl} testId={`${testId}-install`}>
      {text}
    </GithubAppInstallLink>
  );
  if (installations.isPending)
    return (
      <span data-testid={testId}>· Checking where the app is installed…</span>
    );
  if (installations.isError)
    return (
      <span data-testid={testId}>
        · Couldn&apos;t check where the app is installed.{" "}
        <button
          type="button"
          disabled={installations.isFetching}
          onClick={() => void installations.refetch()}
          data-testid={`${testId}-retry`}
          className="font-medium text-accent underline-offset-2 hover:underline disabled:opacity-50"
        >
          Try again
        </button>{" "}
        or {install("install the app")}
      </span>
    );
  const { accounts } = installations.data;
  if (accounts.length === 0)
    return (
      <span data-testid={testId}>
        · {appLabel} on no account yet. {install("Install the app")}{" "}
        {INSTALL_REACH}.
      </span>
    );
  const suspended = accounts.filter((account) => account.suspended).length;
  return (
    <>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        data-testid={`${testId}-toggle`}
        className="flex min-w-0 items-center gap-0.5 text-left hover:text-foreground"
      >
        <span className="min-w-0" data-testid={testId}>
          {appLabel} on {installationsCountLabel(installations.data)}
          {suspended > 0 && (
            <span
              className="font-medium text-warning-fg"
              data-testid={`${testId}-suspended`}
            >
              {" "}
              · {suspended} suspended
            </span>
          )}
        </span>
        <ChevronRight
          size={12}
          aria-hidden
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <InstallationsList
          installations={installations.data}
          installUrl={installUrl}
          testId={testId}
        />
      )}
    </>
  );
}

function InstallationsList({
  installations,
  installUrl,
  testId,
}: {
  installations: Installations;
  installUrl: string;
  testId: string;
}) {
  const { accounts } = installations;
  return (
    <ul className="mt-1.5 flex basis-full flex-col gap-1.5">
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
      {installations.truncated && (
        <li className="text-muted-foreground">
          And more GitHub does not list here.
        </li>
      )}
      <li className="flex min-h-5 items-center">
        <GithubAppInstallLink url={installUrl} testId={`${testId}-install`}>
          Install on another account
        </GithubAppInstallLink>
      </li>
    </ul>
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
