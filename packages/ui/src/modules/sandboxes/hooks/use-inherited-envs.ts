import {
  type ConnectionView,
  displayNameForTemplate,
  isProtectedAgentEnvName,
  providerTypeForTemplateId,
} from "api-server-api";
import { useMemo } from "react";

import type { EnvVar } from "../../../types.js";
import { providerName } from "../../providers/lib/provider-rows.js";

export interface InheritedEnv {
  name: string;
  value: string;
  source: "system" | { label: string; kind: "provider" | "connection" };
  shadowed: boolean;
}

interface Args {
  agentEnv: readonly EnvVar[];
  apps: readonly ConnectionView[];
  appIdsSet: ReadonlySet<string>;
  envVars: readonly EnvVar[];
}

export function inheritedEnvs({
  agentEnv,
  apps,
  appIdsSet,
  envVars,
}: Args): InheritedEnv[] {
  const items: InheritedEnv[] = agentEnv
    .filter((e) => isProtectedAgentEnvName(e.name))
    .map((e) => ({
      name: e.name,
      value: e.value,
      source: "system" as const,
      shadowed: false,
    }));
  const userEnvNames = new Set(envVars.map((e) => e.name));
  for (const a of apps.filter((a) => appIdsSet.has(a.id))) {
    const provider = providerTypeForTemplateId(a.templateId);
    const source = provider
      ? {
          label: displayNameForTemplate(a.templateId) ?? providerName(provider),
          kind: "provider" as const,
        }
      : { label: a.name, kind: "connection" as const };
    for (const c of a.contributions)
      if (c.kind === "env")
        items.push({
          name: c.name,
          value: c.placeholder,
          source,
          shadowed: userEnvNames.has(c.name),
        });
  }
  return items;
}

export function useInheritedEnvs(args: Args): InheritedEnv[] {
  const { agentEnv, apps, appIdsSet, envVars } = args;
  return useMemo(
    () => inheritedEnvs({ agentEnv, apps, appIdsSet, envVars }),
    [agentEnv, apps, appIdsSet, envVars],
  );
}
