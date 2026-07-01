/**
 * Inert safety for the secrets→connections cutover (#1273).
 *
 * Until the migration has drained every install, an agent may still grant a
 * legacy secret (not yet flipped, or a skip-and-log case). The controller's
 * kept `host-pattern` branch keeps *injecting* such a secret's credential at
 * the gateway, but injection alone isn't enough — the harness also needs the
 * credential's env placeholders (e.g. `ANTHROPIC_API_KEY`) in the agent
 * container to actually use it. The deleted secrets module supplied that env;
 * this source preserves it from the migration's self-contained reader so no
 * agent loses its credential env during the upgrade window.
 *
 * Returns `[]` once an agent has no legacy grants — the steady state once the
 * migration has flipped everything to Connections (which carry their own env).
 * Removed by the #1273 follow-up alongside the migration module.
 */
import type { Contribution } from "api-server-api";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  AGENTS_PLURAL,
  LABEL_OWNER,
} from "../../agents/infrastructure/labels.js";
import { listLegacySecrets } from "./legacy-secret-reader.js";

export function createLegacySecretEnvSource(deps: { k8sClient: K8sClient }): {
  forAgent(agentId: string): Promise<Contribution[]>;
} {
  return {
    async forAgent(agentId): Promise<Contribution[]> {
      const agent = await deps.k8sClient.getCustomObject(
        AGENTS_PLURAL,
        agentId,
      );
      const owner = agent?.metadata?.labels?.[LABEL_OWNER];
      if (!owner) return [];
      const grantedSecretIds = toStringArray(
        (agent?.spec as { grantedSecretIds?: unknown } | undefined)
          ?.grantedSecretIds,
      );
      if (grantedSecretIds.length === 0) return [];

      const granted = new Set(grantedSecretIds);
      const out: Contribution[] = [];
      const seen = new Set<string>();
      for (const s of await listLegacySecrets(deps.k8sClient, owner)) {
        if (!granted.has(s.id)) continue;
        for (const m of s.envMappings) {
          // First occurrence in list order wins on name collision.
          if (seen.has(m.envName)) continue;
          seen.add(m.envName);
          out.push({
            kind: "env",
            name: m.envName,
            placeholder: m.placeholder,
          });
        }
      }
      return out;
    },
  };
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}
