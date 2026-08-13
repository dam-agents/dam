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
  /** The template's own `repositories` / `permissions` inputs, rendered as
   *  plain text fields whenever the installation has not been read. */
  fallbackInputs: ConnectionTemplateInput[];
  /** Whether this template requires a host — the probe cannot resolve a
   *  GitHub Enterprise REST base without one. */
  hostRequired: boolean;
}

/** Narrows a GitHub App connection by picking from what the installation
 *  actually grants, rather than typing names and levels blind. The selection
 *  lives in the form's own fields — this renders from them and writes back
 *  through them, so there is no second copy to drift. */
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

  // Which installation the current result describes. Editing any part of it
  // leaves the rendered lists — and the selection made against them — talking
  // about a different installation than the one being created.
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
    // A selection is only meaningful against the installation it was made on:
    // ids may name different repositories elsewhere, and a level may exceed
    // what the new installation grants. Typed names go too — when the listing
    // is unavailable they are the selection, and they name repositories in the
    // account the user has just navigated away from.
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

  // The template's own text input for a scope field, used wherever the picker
  // has nothing to offer in its place.
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
            // The grant was read but its repository list was not. Permissions
            // are still pickable; repositories fall back to being typed.
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
                // The list is a prefix, so a repository past it can only be
                // reached by name — offer that rather than let the checkboxes
                // read as the whole set.
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
        // Until the installation has been read — and if reading it fails —
        // narrowing stays typeable, so a probe that cannot run never costs the
        // user the ability to limit the token.
        fallbackInputs.map((input) => textInput(input.name))
      )}
    </div>
  );
}
