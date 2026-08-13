import { type ConnectionView, isProtectedAgentEnvName } from "api-server-api";
import { useMemo } from "react";

import type { EnvVar } from "../../../types.js";
import type { InheritedEnv } from "../../agents/components/configure-agent/env-tab.js";

interface Args {
  agentEnv: readonly EnvVar[];
  apps: readonly ConnectionView[];
  appIdsSet: ReadonlySet<string>;
  envVars: readonly EnvVar[];
}

export function useInheritedEnvs({
  agentEnv,
  apps,
  appIdsSet,
  envVars,
}: Args): InheritedEnv[] {
  return useMemo(() => {
    const items: InheritedEnv[] = agentEnv
      .filter((e) => isProtectedAgentEnvName(e.name))
      .map((e) => ({
        name: e.name,
        value: e.value,
        source: "system" as const,
      }));
    const userEnvNames = new Set(envVars.map((e) => e.name));
    for (const a of apps.filter((a) => appIdsSet.has(a.id))) {
      const envContribs = a.contributions.filter(
        (c): c is Extract<typeof c, { kind: "env" }> => c.kind === "env",
      );
      for (const c of envContribs) {
        if (userEnvNames.has(c.name)) continue;
        items.push({
          name: c.name,
          value: c.placeholder,
          source: { appLabel: a.name },
        });
      }
    }
    return items;
  }, [agentEnv, apps, appIdsSet, envVars]);
}
