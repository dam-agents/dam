import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import { AGENTS_PLURAL } from "../../agents/infrastructure/labels.js";

export interface AgentL7HostsPort {
  set(agentId: string, hosts: readonly string[]): Promise<void>;
}

const PATCH_ATTEMPTS = 3;

function sameSet(a: Set<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((h) => a.has(h));
}

export function createAgentL7HostsPort(client: K8sClient): AgentL7HostsPort {
  return {
    async set(agentId, hosts) {
      const desired = [...new Set(hosts)].sort();
      let lastErr: unknown;
      for (let attempt = 0; attempt < PATCH_ATTEMPTS; attempt++) {
        const agent = await client.getCustomObject(AGENTS_PLURAL, agentId);
        if (!agent) return;
        const spec = (agent.spec ?? {}) as { l7Hosts?: string[] };
        const current = new Set(spec.l7Hosts ?? []);
        if (sameSet(current, desired)) return;
        try {
          const result = await client.patchCustomObject(
            AGENTS_PLURAL,
            agentId,
            {
              metadata: { resourceVersion: agent.metadata?.resourceVersion },
              spec: { l7Hosts: desired },
            },
          );
          const written = new Set(
            ((result.spec ?? {}) as { l7Hosts?: string[] }).l7Hosts ?? [],
          );
          if (!sameSet(written, desired)) {
            throw new Error(
              `spec.l7Hosts write for agent ${agentId} did not persist — ` +
                `is the agents CRD older than schema generation 5?`,
            );
          }
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    },
  };
}
