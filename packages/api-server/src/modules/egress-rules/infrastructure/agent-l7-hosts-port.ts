import type { AgentStore } from "../../agents/infrastructure/agent-store.js";

export interface AgentL7HostsPort {
  set(agentId: string, hosts: readonly string[]): Promise<void>;
}

function sameSet(a: Set<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((h) => a.has(h));
}

export function createAgentL7HostsPort(store: AgentStore): AgentL7HostsPort {
  return {
    async set(agentId, hosts) {
      const desired = [...new Set(hosts)].sort();
      const record = await store.get(agentId);
      if (!record) return;
      if (sameSet(new Set(record.spec.l7Hosts ?? []), desired)) return;
      await store.patchSpec(agentId, { l7Hosts: desired });
    },
  };
}
