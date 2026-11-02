import type { GitHubAppInstallationProbe } from "api-server-api";
import type { ReactNode } from "react";

import { Callout } from "@/components/ui/callout";
import { CheckboxItem } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import {
  levelsUpTo,
  type PermissionLevel,
} from "../lib/github-app-scope-fields.js";

export function RepositorySection({
  installation,
  selected,
  onToggle,
}: {
  installation: GitHubAppInstallationProbe;
  selected: Set<number>;
  onToggle: (id: number, checked: boolean) => void;
}) {
  if (installation.repositories.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Repositories</legend>
      <p className="text-sm text-muted-foreground">
        Leave all unticked to reach every repository the installation can reach,
        with the permissions below.
        {installation.repositorySelection === "all" &&
          " This app is installed on every repository in the account, so that set grows as the account does — tick the ones this agent needs to pin it."}
      </p>
      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
        {installation.repositories.map((repo) => (
          <CheckboxItem
            key={repo.id}
            label={repo.name}
            labelClassName="font-mono"
            checked={selected.has(repo.id)}
            onCheckedChange={(checked) => onToggle(repo.id, checked === true)}
            testId={`github-app-repo-${repo.name}`}
          />
        ))}
      </div>
    </fieldset>
  );
}

export function PermissionSection({
  installation,
  selection,
  onChange,
}: {
  installation: GitHubAppInstallationProbe;
  selection: Record<string, PermissionLevel>;
  onChange: (name: string, level: PermissionLevel | "off") => void;
}) {
  const granted = Object.keys(installation.permissions).sort();
  if (granted.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Permissions</legend>
      <p className="text-sm text-muted-foreground">
        Leave all off to keep every permission the app was granted, on the
        repositories above. A permission can be set no higher than the
        installation holds it.
      </p>
      <div className="flex flex-col gap-1">
        {granted.map((name) => (
          <div
            key={name}
            className="flex items-center justify-between gap-4 rounded-md px-2 py-1 hover:bg-muted/50"
          >
            <span className="font-mono text-sm">{name}</span>
            <RadioGroup
              className="flex flex-row gap-3"
              value={selection[name] ?? "off"}
              onValueChange={(level) =>
                onChange(name, level as PermissionLevel | "off")
              }
              aria-label={`Level for ${name}`}
            >
              <RadioGroupItem
                value="off"
                label="Off"
                testId={`github-app-perm-${name}-off`}
              />
              {levelsUpTo(installation.permissions[name]).map((level) => (
                <RadioGroupItem
                  key={level}
                  value={level}
                  label={level[0].toUpperCase() + level.slice(1)}
                  testId={`github-app-perm-${name}-${level}`}
                />
              ))}
            </RadioGroup>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

interface ScopeSelection {
  repoIds: Set<number>;
  permissions: Record<string, PermissionLevel>;
  toggleRepo: (id: number, checked: boolean) => void;
  setPermission: (name: string, level: PermissionLevel | "off") => void;
}

interface GithubScopeFieldsProps {
  installation: GitHubAppInstallationProbe;
  selection: ScopeSelection;
  locked?: { note: ReactNode; saving: string };
  unlisted?: { count: number; note: string };
  dropped?: { count: number; widens: boolean };
  children?: ReactNode;
}

// UNIT_BOUNDARY_DESCRIPTION: the repositories and permissions body both GitHub scope dialogs render. A locked listing replaces the repository list with why it cannot be changed and what saving keeps; the unlisted callout names the selected repositories a partial listing does not show, which saving keeps, and the dropped callout counts those a complete listing does not show, which saving drops, or asks for another repository when none would be left. The caller adds whatever else its scope can say.
export function GithubScopeFields({
  installation,
  selection,
  locked,
  unlisted,
  dropped,
  children,
}: GithubScopeFieldsProps) {
  return (
    <>
      {locked ? (
        <Callout tone="muted" size="sm">
          {locked.note}
          {" — "}
          {locked.saving}
        </Callout>
      ) : (
        <>
          <RepositorySection
            installation={installation}
            selected={selection.repoIds}
            onToggle={selection.toggleRepo}
          />
          {unlisted && (
            <Callout tone="muted" size="sm">
              {unlisted.count} selected{" "}
              {unlisted.count === 1 ? "repository is" : "repositories are"} not
              in the list above{unlisted.note}. They stay selected when you
              save.
            </Callout>
          )}
          {dropped && dropped.count > 0 && (
            <Callout tone="danger" size="sm">
              {dropped.count} selected{" "}
              {dropped.count === 1 ? "repository is" : "repositories are"} no
              longer reachable — removed, deleted, moved, or access to{" "}
              {dropped.count === 1 ? "it" : "them"} was revoked.{" "}
              {dropped.widens
                ? "No selected repository would be left, which reaches every repository: choose one from the list, or full access."
                : `Saving will drop ${dropped.count === 1 ? "it" : "them"}.`}
            </Callout>
          )}
        </>
      )}
      <PermissionSection
        installation={installation}
        selection={selection.permissions}
        onChange={selection.setPermission}
      />
      {children}
    </>
  );
}
