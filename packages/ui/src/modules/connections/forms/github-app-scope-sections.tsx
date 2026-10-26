import type { GitHubAppInstallationProbe } from "api-server-api";

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
      <p className="text-xs text-muted-foreground">
        Nothing ticked means every repository the installation can reach.
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
      <p className="text-xs text-muted-foreground">
        All off means every permission the app was granted. A permission can be
        set no higher than the installation holds it.
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
