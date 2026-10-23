import type {
  ConnectionCreateInput,
  ConnectionTemplateView,
} from "api-server-api";

import { compact } from "@/lib/compact";

import { validateConnectionName } from "./connection-name.js";

export interface CreateFormValues {
  name: string;
  fields: Record<string, string>;
  overrideDefaults: boolean;
}

export function buildCreatePayload(
  template: ConnectionTemplateView,
  { name, fields, overrideDefaults }: CreateFormValues,
): ConnectionCreateInput | { error: string } {
  const inputsByName = new Map(template.inputs.map((i) => [i.name, i]));
  const submitted = (k: string): string | undefined => {
    const input = inputsByName.get(k);
    if (!input) return undefined;
    if (input.state === "overridable" && !overrideDefaults) return undefined;
    const v = (fields[k] ?? "").trim();
    return v.length > 0 ? v : undefined;
  };

  const trimmed = name.trim();
  const nameError = validateConnectionName(trimmed);
  if (nameError) return { error: nameError };
  const common = {
    templateId: template.id,
    name: trimmed,
  };
  switch (template.authKind) {
    case "oauth":
      return compact({
        ...common,
        authKind: "oauth" as const,
        url: submitted("url"),
        host: submitted("host"),
        clientId: submitted("clientId"),
        clientSecret: submitted("clientSecret"),
        appSlug: submitted("appSlug"),
      });
    case "client-credentials":
      return compact({
        ...common,
        authKind: "client-credentials" as const,
        host: submitted("host"),
        issuerUrl: submitted("issuerUrl"),
        clientId: submitted("clientId"),
        clientSecret: submitted("clientSecret"),
        scopes: submitted("scopes"),
        audience: submitted("audience"),
        headerName: submitted("headerName"),
        valueFormat: submitted("valueFormat"),
        envName: submitted("envName"),
      });
    case "github-app": {
      const host = submitted("host");
      const appId = submitted("appId");
      const installationId = submitted("installationId");
      const privateKey = submitted("privateKey");
      if (inputsByName.get("host")?.state === "required" && !host) {
        return { error: "Host is required" };
      }
      if (!appId) return { error: "App ID is required" };
      if (!installationId) return { error: "Installation ID is required" };
      if (!privateKey) return { error: "Private key is required" };
      return compact({
        ...common,
        authKind: "github-app" as const,
        host,
        appId,
        installationId,
        privateKey,
        repositories: submitted("repositories"),
        repositoryIds: submitted("repositoryIds"),
        permissions: submitted("permissions"),
      });
    }
    case "header": {
      const value = submitted("value");
      if (!value) return { error: "Secret value is required" };
      const configInputs: Record<string, string> = {};
      for (const input of template.inputs) {
        if (!input.configInput) continue;
        const v = submitted(input.name);
        if (v) configInputs[input.name] = v;
      }
      return compact({
        ...common,
        authKind: "header" as const,
        host: submitted("host"),
        headerName: submitted("headerName"),
        valueFormat: submitted("valueFormat"),
        envName: submitted("envName"),
        caData: submitted("caData"),
        configInputs:
          Object.keys(configInputs).length > 0 ? configInputs : undefined,
        value,
      });
    }
    case "none":
      return compact({
        ...common,
        authKind: "none" as const,
        url: submitted("url"),
        headerName: submitted("headerName"),
        value: submitted("value"),
      });
  }
}
