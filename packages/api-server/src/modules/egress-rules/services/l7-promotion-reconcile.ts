import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";
import type { AgentL7HostsPort } from "../infrastructure/k8s-agent-l7-hosts-port.js";
import { promotedHosts, type PromotionRule } from "../domain/l7-promotion.js";

/** The current `spec.l7Hosts` of one agent, from a single list read. */
export interface AgentL7State {
  agentId: string;
  current: readonly string[];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((h) => set.has(h));
}

/**
 * Reconcile every agent's `spec.l7Hosts` back to the pure projection of its
 * active narrow rules. The per-mutation promotion is non-transactional
 * (Postgres and the Agent CR cannot share a transaction), so a projection can
 * drift when a CR patch fails after retries — or when the process dies between
 * the rule commit and the patch, which no synchronous compensation can cover.
 * Because `spec.l7Hosts` is a deterministic function of the rules, the fix is
 * a reconcile from truth, not a heal-at-boot special case: this runs on a
 * timer like every other derived-state reconcile.
 *
 * One list, in-memory diff, write only the deltas — the controller shape, not
 * a get-per-agent loop. The rule scan is one query; the agent state is one
 * list; a converged fleet issues zero CR writes (and zero gateway rolls).
 * Listing all agents (not just those with rules) is deliberate: it also heals
 * *demotion* drift — an agent whose last narrowing was revoked but whose
 * clearing patch failed still carries a stale promoted host, and only a scan
 * that sees agents-with-no-rules can drop it. Never throws — per-agent write
 * failures are isolated and counted.
 */
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
    // Absent from the rule scan ⇒ no active narrowing ⇒ desired is empty,
    // which demotes a stale promoted host.
    const desired = promotedHosts(desiredByAgent.get(agentId) ?? []);
    if (sameSet(current, desired)) continue;
    drifted++;
    try {
      // `set` re-reads for a fresh resourceVersion and conditional-patches;
      // only the drifted agents pay that read, ~none in a converged fleet.
      await deps.l7Hosts.set(agentId, desired);
    } catch (err) {
      failed++;
      deps.log(`patching agent ${agentId} failed: ${String(err)}`);
    }
  }
  return { scanned: agents.length, drifted, failed };
}
