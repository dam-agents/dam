import type {
  EgressRulesRepository,
  NewEgressRule,
} from "../infrastructure/egress-rules-repository.js";
import { promotedHosts } from "../domain/l7-promotion.js";
import type { AgentL7HostsPort } from "../infrastructure/k8s-agent-l7-hosts-port.js";

/**
 * Insert path for rules born from inbox verdicts (approve-permanent /
 * deny-forever).
 *
 * Mirrors the manual-create path's L7 promotion: a narrow rule written from
 * an inbox verdict (possible when the held request was plain HTTP, where
 * method/path are visible without MITM) must promote its host onto the
 * agent's L7 chain, or the rule's HTTPS half is silently unenforced (#2322).
 * Promotion is per-agent — `spec.l7Hosts` on the Agent CR (#2865) — and
 * reconverged from the agent's full active rule set so the write is a pure
 * projection of the rules table.
 */
export interface CreateEgressRuleWriterDeps {
  repo: EgressRulesRepository;
  /** Optional so non-cluster contexts (tests) can skip the side effect. */
  l7Hosts?: AgentL7HostsPort;
}

export function createEgressRuleWriter(deps: CreateEgressRuleWriterDeps): {
  insert(input: NewEgressRule): Promise<void>;
} {
  return {
    async insert(row) {
      await deps.repo.insert(row);
      if (!deps.l7Hosts) return;
      const rows = await deps.repo.listForAgent(row.agentId);
      await deps.l7Hosts.set(row.agentId, promotedHosts(rows));
    },
  };
}
