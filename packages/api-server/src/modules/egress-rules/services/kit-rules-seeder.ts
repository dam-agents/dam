import { randomUUID } from "node:crypto";
import type { StarterKitEgressRule } from "api-server-api";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";
import type { AgentL7HostsPort } from "../infrastructure/k8s-agent-l7-hosts-port.js";
import { reconvergeAgentL7Hosts } from "./l7-promotion-reconcile.js";

export interface KitRulesSeeder {
  seed(
    agentId: string,
    rules: readonly StarterKitEgressRule[],
    decidedBy: string,
  ): Promise<void>;
}

export function createKitRulesSeeder(deps: {
  repo: Pick<
    EgressRulesRepository,
    "insertOrPromoteFromPreset" | "listForAgent"
  >;
  l7Hosts: Pick<AgentL7HostsPort, "set">;
}): KitRulesSeeder {
  return {
    async seed(agentId, rules, decidedBy) {
      if (rules.length === 0) return;
      for (const rule of rules) {
        const row = await deps.repo.insertOrPromoteFromPreset({
          id: randomUUID(),
          agentId,
          host: rule.host,
          ...(rule.port ? { port: rule.port } : {}),
          method: rule.method,
          pathPattern: rule.pathPattern,
          verdict: rule.verdict,
          decidedBy,
          source: "kit",
        });
        if (row.verdict !== rule.verdict)
          throw new Error(
            `the kit's ${rule.verdict} rule for ${rule.host} clashes with an existing ${row.verdict} rule`,
          );
      }
      await reconvergeAgentL7Hosts(deps, agentId);
    },
  };
}
