import { Enterprise, User, WarningAlt } from "@carbon/icons-react";
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
  sizedAvatarUrl,
} from "../lib/github-installations.js";
import { activeInstallUrl } from "./github-app-install-hint.js";

const AVATARS_SHOWN = 5;

const SIGN_IN_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  "github",
  "github-enterprise",
]);

type InstallationsConnection = Pick<
  ConnectionView,
  "id" | "templateId" | "host" | "appSlug" | "status" | "parentId"
>;

// UNIT_BOUNDARY_DESCRIPTION: the organizations and accounts a GitHub sign-in's app is installed on, under the sign-in's row: their avatars and a count that opens the list, each with its status, or one plain line while the app is installed nowhere, so the user sees whether the account they need is covered before an agent fails on it.
export function GithubAppInstallations({
  connection,
  indented,
}: {
  connection: InstallationsConnection;
  indented: boolean;
}) {
  const listed =
    SIGN_IN_TEMPLATE_IDS.has(connection.templateId) &&
    activeInstallUrl(connection) !== null;
  const installations = useGitHubAppInstallations(connection.id, listed);
  const [open, setOpen] = useState(false);
  if (!listed) return null;
  const testId = `github-installations-${connection.id}`;
  const line = cn(
    "mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground",
    indented && "pl-6",
  );
  if (installations.isPending)
    return (
      <p className={line} data-testid={testId}>
        Checking where the app is installed…
      </p>
    );
  if (installations.isError)
    return (
      <p className={line} data-testid={testId}>
        <WarningAlt size={12} aria-hidden className="shrink-0 text-warning" />
        <span className="min-w-0 truncate">
          Couldn&apos;t check where the app is installed.
        </span>
      </p>
    );
  const { accounts } = installations.data;
  if (accounts.length === 0)
    return (
      <p className={line} data-testid={testId}>
        <WarningAlt size={12} aria-hidden className="shrink-0 text-warning" />
        <span className="min-w-0 truncate">
          Not installed on any organization yet. Install the app to reach its
          repositories.
        </span>
      </p>
    );
  return (
    <div
      className={cn("mt-1 text-xs", indented && "pl-6")}
      data-testid={testId}
    >
      <DisclosureToggle
        open={open}
        onToggle={() => setOpen(!open)}
        chevronSize={12}
        testId={`${testId}-toggle`}
        className="max-w-full text-muted-foreground hover:text-foreground"
      >
        <span className="flex shrink-0 -space-x-1">
          {accounts.slice(0, AVATARS_SHOWN).map((account) => (
            <AccountAvatar key={account.targetId} account={account} />
          ))}
        </span>
        <span className="min-w-0 truncate">
          Installed on {installationsCountLabel(installations.data)}
        </span>
      </DisclosureToggle>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1.5 pl-5">
          {accounts.map((account) => (
            <li
              key={account.targetId}
              className="flex min-w-0 items-center gap-2"
              data-testid={`${testId}-account-${account.login}`}
            >
              <AccountAvatar account={account} />
              <span className="min-w-0 truncate font-medium text-foreground">
                {account.login}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {account.kind === "user" ? "Personal account · " : ""}
                {account.repositorySelection === "all"
                  ? "All repositories"
                  : "Selected repositories"}
              </span>
              <Badge
                size="sm"
                variant={account.suspended ? "warning" : "success"}
                className="shrink-0"
              >
                {account.suspended ? "Suspended" : "Installed"}
              </Badge>
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

const AVATAR_PX = 16;

function AccountAvatar({ account }: { account: GitHubAppInstallationAccount }) {
  const [failed, setFailed] = useState(false);
  const shape = cn(
    "shrink-0 bg-muted ring-2 ring-card",
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
      className={cn(shape, "inline-flex size-4 items-center justify-center")}
    >
      <Icon size={11} aria-hidden />
    </span>
  );
}
