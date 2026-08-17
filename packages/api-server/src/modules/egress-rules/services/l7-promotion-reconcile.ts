import { promotedHosts, type PromotionRule } from "api-server-api";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";
import type { AgentL7HostsPort } from "../infrastructure/k8s-agent-l7-hosts-port.js";

export interface AgentL7State {
  agentId: string;
  current: readonly string[];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((h) => set.has(h));
}

export async function reconcileL7Promotions(deps: {
  repo: Pick<EgressRulesRepository, "listActiveForPromotionScan">;
  listAgentL7State: () => Promise<AgentL7State[]>;
  l7Hosts: Pick<AgentL7HostsPort, "set">;
  log: (message: string) => void;
}): Promise<{ scanned: number; drifted: number; failed: number }> {
  let rules;
  let agents;
  try {
    [rules, agents] = await Promise.all([
      deps.repo.listActiveForPromotionScan(),
      deps.listAgentL7State(),
    ]);
  } catch (err) {
    deps.log(`scan failed, will retry next tick: ${String(err)}`);
    return { scanned: 0, drifted: 0, failed: 1 };
  }

  const desiredByAgent = new Map<string, PromotionRule[]>();
  for (const r of rules) {
    const list = desiredByAgent.get(r.agentId) ?? [];
    list.push(r);
    desiredByAgent.set(r.agentId, list);
  }

  let drifted = 0;
  let failed = 0;
  for (const { agentId, current } of agents) {
    const desired = promotedHosts(desiredByAgent.get(agentId) ?? []);
    if (sameSet(current, desired)) continue;
    drifted++;
    try {
      await deps.l7Hosts.set(agentId, desired);
    } catch (err) {
      failed++;
      deps.log(`patching agent ${agentId} failed: ${String(err)}`);
    }
  }
  return { scanned: agents.length, drifted, failed };
}
