import { randomUUID } from "node:crypto";
import {
  CHILD_DRIVER_SOURCE,
  CHILD_INHERITED_SOURCE,
  isWildcardEgressRule,
  type ChildEgressRuleSeed,
  type ChildInheritance,
} from "api-server-api";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";
import type { EgressRuleWriter } from "./egress-rule-writer.js";

export interface ChildEgressSeeder {
  seed(agentId: string, inheritance: ChildInheritance): Promise<void>;
  setOpenRules(
    agentId: string,
    decidedBy: string,
    rules: readonly ChildEgressRuleSeed[],
  ): Promise<{ waiting: { host: string; id: string }[] }>;
}

// UNIT_BOUNDARY_DESCRIPTION: where an open child's rule to a wildcard host goes instead of being written: a request its owner decides.
export interface WildcardEgressPort {
  request(input: {
    childId: string;
    driverId: string;
    rule: ChildEgressRuleSeed;
  }): Promise<{ id: string }>;
  withdraw(childId: string, keepHosts: ReadonlySet<string>): Promise<void>;
}

const hostOf = (rule: { host: string }): string =>
  rule.host.trim().toLowerCase();

// UNIT_BOUNDARY_DESCRIPTION: the rules a child whose egress is its own starts with, written as its launching agent's: an open child's are the ones the launching agent set, and can be replaced by it, except a rule to a wildcard host, which waits for the owner's approval and goes when the launching agent drops it; a scoped child's are a copy, made once at launch, of the rules its parent's requests are decided under (the parent's root's, or the parent's own when it is itself detached) for the hosts named, or all of them. Nothing here follows the parent afterwards.
export function createChildEgressSeeder(deps: {
  repo: EgressRulesRepository;
  writer: EgressRuleWriter;
  rulesOwnerOf: (agentId: string) => Promise<string | null>;
  wildcardEgress: WildcardEgressPort;
}): ChildEgressSeeder {
  async function write(
    agentId: string,
    decidedBy: string,
    source: typeof CHILD_DRIVER_SOURCE | typeof CHILD_INHERITED_SOURCE,
    rule: ChildEgressRuleSeed,
  ): Promise<void> {
    await deps.writer.insert({
      id: randomUUID(),
      agentId,
      host: rule.host,
      ...(rule.port !== undefined ? { port: rule.port } : {}),
      method: rule.method ?? "*",
      pathPattern: rule.pathPattern ?? "*",
      verdict: rule.verdict,
      decidedBy,
      source,
    });
  }

  return {
    async seed(agentId, inheritance) {
      const seed = inheritance.egressSeed;
      if (inheritance.egressFrom === "open" && seed && "rules" in seed) {
        for (const rule of seed.rules)
          if (isWildcardEgressRule(rule))
            await deps.wildcardEgress.request({
              childId: agentId,
              driverId: inheritance.parentAgentId,
              rule,
            });
          else
            await write(
              agentId,
              inheritance.parentAgentId,
              CHILD_DRIVER_SOURCE,
              rule,
            );
        return;
      }
      if (inheritance.egressFrom !== "scoped" || !seed || !("hosts" in seed))
        return;
      const owner = await deps.rulesOwnerOf(inheritance.parentAgentId);
      if (!owner) return;
      const named =
        seed.hosts === "all"
          ? null
          : new Set(seed.hosts.map((h) => h.toLowerCase()));
      for (const row of await deps.repo.listForAgent(owner)) {
        if (named && !named.has(row.host.toLowerCase())) continue;
        await write(
          agentId,
          inheritance.parentAgentId,
          CHILD_INHERITED_SOURCE,
          {
            host: row.host,
            ...(row.port !== undefined ? { port: row.port } : {}),
            method: row.method,
            pathPattern: row.pathPattern,
            verdict: row.verdict,
          },
        );
      }
    },

    async setOpenRules(agentId, decidedBy, rules) {
      const wildcardHosts = new Set(
        rules.filter(isWildcardEgressRule).map(hostOf),
      );
      const granted = new Set<string>();
      for (const row of await deps.repo.listForAgent(agentId)) {
        if (row.source === CHILD_DRIVER_SOURCE) {
          await deps.repo.revoke(row.id);
          continue;
        }
        if (!isWildcardEgressRule(row)) continue;
        if (wildcardHosts.has(hostOf(row))) granted.add(hostOf(row));
        else await deps.repo.revoke(row.id);
      }
      await deps.wildcardEgress.withdraw(agentId, wildcardHosts);
      const waiting: { host: string; id: string }[] = [];
      for (const rule of rules) {
        if (!isWildcardEgressRule(rule)) {
          await write(agentId, decidedBy, CHILD_DRIVER_SOURCE, rule);
          continue;
        }
        if (granted.has(hostOf(rule))) continue;
        const { id } = await deps.wildcardEgress.request({
          childId: agentId,
          driverId: decidedBy,
          rule,
        });
        waiting.push({ host: hostOf(rule), id });
      }
      return { waiting };
    },
  };
}
