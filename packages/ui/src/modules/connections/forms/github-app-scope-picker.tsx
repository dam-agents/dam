import type { ConnectionTemplateInput } from "api-server-api";
import { useEffect, useRef } from "react";
import { type Control, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

import { useProbeGitHubAppInstallation } from "../api/mutations.js";
import {
  canProbe,
  type PermissionLevel,
  readPermissions,
  readRepositoryIds,
  writePermissions,
  writeRepositoryIds,
} from "../lib/github-app-scope-fields.js";
import type { TemplateFormValues } from "../lib/template-form-schema.js";
import {
  PermissionSection,
  RepositorySection,
} from "./github-app-scope-sections.js";
import { TemplateFieldInput } from "./template-field-input.js";

interface Props {
  control: Control<TemplateFormValues>;
  templateId: string;
  setField: (name: string, value: string) => void;
  fallbackInputs: ConnectionTemplateInput[];
  hostRequired: boolean;
}

export function GithubAppScopePicker({
  control,
  templateId,
  setField,
  fallbackInputs,
  hostRequired,
}: Props) {
  const fields = useWatch({ control, name: "fields" }) ?? {};
  const probe = useProbeGitHubAppInstallation();
  const installation = probe.data;

  const identity = [
    fields.host?.trim() ?? "",
    fields.appId?.trim() ?? "",
    fields.installationId?.trim() ?? "",
  ].join(" ");
  const probedIdentity = useRef<string | null>(null);
  const { reset: resetProbe } = probe;

  useEffect(() => {
    if (probedIdentity.current === null) return;
    if (probedIdentity.current === identity) return;
    probedIdentity.current = null;
    resetProbe();
    setField("repositoryIds", "");
    setField("repositories", "");
    setField("permissions", "");
  }, [identity, resetProbe, setField]);

  const permissions = readPermissions(fields.permissions ?? "");
  const selectedRepoIds = new Set(
    readRepositoryIds(fields.repositoryIds ?? ""),
  );

  const setPermission = (name: string, level: PermissionLevel | "off") => {
    const next = { ...permissions };
    if (level === "off") delete next[name];
    else next[name] = level;
    setField("permissions", writePermissions(next));
  };

  const toggleRepo = (id: number, checked: boolean) => {
    const next = new Set(selectedRepoIds);
    if (checked) next.add(id);
    else next.delete(id);
    setField("repositoryIds", writeRepositoryIds([...next]));
  };

  const ready = canProbe(fields, hostRequired);

  const textInput = (name: string) => {
    const input = fallbackInputs.find((i) => i.name === name);
    if (!input) return null;
    return (
      <TemplateFieldInput
        key={input.name}
        control={control}
        templateId={templateId}
        input={input}
      />
    );
  };

  const runProbe = () => {
    probedIdentity.current = identity;
    probe.mutate({
      templateId,
      appId: (fields.appId ?? "").trim(),
      installationId: (fields.installationId ?? "").trim(),
      privateKey: fields.privateKey ?? "",
      ...(fields.host?.trim() ? { host: fields.host.trim() } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Limit this connection</SectionLabel>
      <p className="text-sm text-muted-foreground">
        By default the connection can do everything the app installation can.
        Read the installation to narrow it to the repositories and permissions
        this agent actually needs.
      </p>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!ready || probe.isPending}
          onClick={runProbe}
          data-testid="github-app-probe"
        >
          {probe.isPending
            ? "Reading…"
            : installation
              ? "Re-read installation"
              : "Read installation"}
        </Button>
        {!ready && (
          <span className="text-xs text-muted-foreground">
            Fill in the {hostRequired ? "host, " : ""}app ID, installation ID,
            and private key first.
          </span>
        )}
      </div>

      {probe.isError && (
        <Callout tone="danger" size="sm">
          {probe.error.message}
        </Callout>
      )}

      {installation ? (
        <>
          {installation.repositoriesUnavailable ? (
            <>
              <Callout tone="muted" size="sm">
                Couldn&rsquo;t list this installation&rsquo;s repositories, so
                name them instead. Permissions below are still the
                installation&rsquo;s own.
              </Callout>
              {textInput("repositories")}
            </>
          ) : (
            <>
              <RepositorySection
                installation={installation}
                selected={selectedRepoIds}
                onToggle={toggleRepo}
              />
              {installation.repositoriesTruncated && (
                <>
                  <Callout tone="muted" size="sm">
                    This installation reaches more repositories than are listed
                    above. Name any that aren&rsquo;t shown.
                  </Callout>
                  {textInput("repositories")}
                </>
              )}
            </>
          )}
          <PermissionSection
            installation={installation}
            selection={permissions}
            onChange={setPermission}
          />
        </>
      ) : (
        fallbackInputs.map((input) => textInput(input.name))
      )}
    </div>
  );
}
