import { randomUUID } from "node:crypto";
import {
  CHILD_DRIVER_SOURCE,
  CHILD_INHERITED_SOURCE,
  isWildcardEgressRule,
  type ChildEgressRuleSeed,
  type ChildInheritance,
} from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { reachesPastDriver } from "../domain/driver-reach.js";
import type { EgressRuleRow } from "../domain/types.js";
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

// UNIT_BOUNDARY_DESCRIPTION: where an open child's rule that is not its launching agent's to give goes instead of being written: a request its owner decides. `wildcard` is an allow rule to a wildcard host; `wider` is one to a host the launching agent does not reach itself.
export interface OwnerEgressPort {
  request(input: {
    childId: string;
    driverId: string;
    rule: ChildEgressRuleSeed;
    ask: "wildcard" | "wider";
  }): Promise<{ id: string }>;
  withdraw(
    childId: string,
    keep: (request: { host: string; port?: number }) => boolean,
  ): Promise<void>;
}

const hostOf = (rule: { host: string }): string =>
  rule.host.trim().toLowerCase();

const reachKey = (rule: { host: string; port?: number }): string =>
  `${hostOf(rule)}:${rule.port ?? ""}`;

// UNIT_BOUNDARY_DESCRIPTION: the rules a child whose egress is its own starts with, written as its launching agent's: an open child's are the ones the launching agent set, and can be replaced by it, except a rule the launching agent may not give, which waits for the owner's approval and goes when the launching agent drops it: an allow rule to a wildcard host, always, and one to a host the launching agent's own rules (as they are at that moment) do not reach, unless the owner lets the launching agent's root give its children network access of their own. A scoped child's are a copy, made once at launch, of the rules its parent's requests are decided under (the parent's root's, or the parent's own when it is itself detached) for the hosts named, or all of them. Nothing here follows the parent afterwards.
export function createChildEgressSeeder(deps: {
  repo: EgressRulesRepository;
  writer: EgressRuleWriter;
  rulesOwnerOf: (agentId: string) => Promise<string | null>;
  ownEgressGranted: (driverId: string) => Promise<boolean>;
  ownerEgress: OwnerEgressPort;
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

  async function rulesOf(agentId: string): Promise<EgressRuleRow[] | null> {
    const owner = await deps.rulesOwnerOf(agentId);
    return owner ? deps.repo.listForAgent(owner) : null;
  }

  // UNIT_BOUNDARY_DESCRIPTION: which of the rules a driver sets on an open child wait for the owner, and why; a driver whose own rules cannot be found reaches nothing, so each of its allow rules waits.
  async function askOf(
    driverId: string,
    rules: readonly ChildEgressRuleSeed[],
  ): Promise<(rule: ChildEgressRuleSeed) => "wildcard" | "wider" | null> {
    const granted = rules.some((r) => r.verdict === "allow")
      ? await deps.ownEgressGranted(driverId)
      : true;
    const driverRules = granted ? [] : ((await rulesOf(driverId)) ?? []);
    return (rule) => {
      if (isWildcardEgressRule(rule)) return "wildcard";
      if (granted || rule.verdict !== "allow") return null;
      return reachesPastDriver(rule, driverRules) ? "wider" : null;
    };
  }

  return {
    async seed(agentId, inheritance) {
      const seed = inheritance.egressSeed;
      if (inheritance.egressFrom === "open" && seed && "rules" in seed) {
        const askFor = await askOf(inheritance.parentAgentId, seed.rules);
        for (const rule of seed.rules) {
          const ask = askFor(rule);
          if (ask)
            await deps.ownerEgress.request({
              childId: agentId,
              driverId: inheritance.parentAgentId,
              rule,
              ask,
            });
          else
            await write(
              agentId,
              inheritance.parentAgentId,
              CHILD_DRIVER_SOURCE,
              rule,
            );
        }
        return;
      }
      if (inheritance.egressFrom !== "scoped" || !seed || !("hosts" in seed))
        return;
      const parentRules = await rulesOf(inheritance.parentAgentId);
      if (!parentRules) {
        getLogger().warn(
          { agentId, parentAgentId: inheritance.parentAgentId },
          "egress: a scoped child got no copy of its parent's rules, whose owner was not found",
        );
        return;
      }
      const named =
        seed.hosts === "all"
          ? null
          : new Set(seed.hosts.map((h) => h.toLowerCase()));
      for (const row of parentRules) {
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
      const askFor = await askOf(decidedBy, rules);
      const asked = rules
        .map((rule) => ({ rule, ask: askFor(rule) }))
        .filter(
          (r): r is { rule: ChildEgressRuleSeed; ask: "wildcard" | "wider" } =>
            r.ask !== null,
        );
      const askedKeys = new Set(asked.map(({ rule }) => reachKey(rule)));
      const granted = new Set<string>();
      for (const row of await deps.repo.listForAgent(agentId)) {
        if (row.source === CHILD_DRIVER_SOURCE) {
          await deps.repo.revoke(row.id);
          continue;
        }
        if (row.source !== "inbox" && !isWildcardEgressRule(row)) continue;
        if (askedKeys.has(reachKey(row))) granted.add(reachKey(row));
        else await deps.repo.revoke(row.id);
      }
      await deps.ownerEgress.withdraw(agentId, (request) =>
        askedKeys.has(reachKey(request)),
      );
      const waiting: { host: string; id: string }[] = [];
      for (const rule of rules) {
        const ask = askFor(rule);
        if (!ask) {
          await write(agentId, decidedBy, CHILD_DRIVER_SOURCE, rule);
          continue;
        }
        if (granted.has(reachKey(rule))) continue;
        const { id } = await deps.ownerEgress.request({
          childId: agentId,
          driverId: decidedBy,
          rule,
          ask,
        });
        waiting.push({ host: hostOf(rule), id });
      }
      return { waiting };
    },
  };
}
