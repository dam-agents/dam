import type { Contribution } from "api-server-api";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  AGENTS_PLURAL,
  LABEL_OWNER,
} from "../../agents/infrastructure/labels.js";
import { createK8sSecretsPort } from "../infrastructure/k8s-secrets-port.js";

/** `env` contributions for an agent's granted standalone secrets (ADR-040). */
export function createSecretEnvSource(deps: { k8sClient: K8sClient }): {
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
      const secrets = await createK8sSecretsPort(
        deps.k8sClient,
        owner,
      ).listSecrets();

      const out: Contribution[] = [];
      const seen = new Set<string>();
      for (const s of secrets) {
        if (!granted.has(s.id)) continue;
        for (const m of s.envMappings ?? []) {
          // First occurrence in secret-list order wins on name collision.
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
