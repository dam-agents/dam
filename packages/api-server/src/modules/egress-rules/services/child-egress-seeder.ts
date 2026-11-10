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
import { allowBeatsBlock } from "../domain/owner-block.js";
import type { EgressRuleRow } from "../domain/types.js";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";
import type { EgressRuleWriter } from "./egress-rule-writer.js";

export interface ChildEgressSeeder {
  seed(agentId: string, inheritance: ChildInheritance): Promise<void>;
  setOpenRules(
    agentId: string,
    decidedBy: string,
    rules: readonly ChildEgressRuleSeed[],
  ): Promise<{
    waiting: { host: string; id: string }[];
    blocked: { host: string }[];
  }>;
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
    keep: (request: ChildEgressRequestShape) => boolean,
  ): Promise<void>;
}

// UNIT_BOUNDARY_DESCRIPTION: what a waiting request asks for: a host and port, and the method and path the driver's rule names, so a changed rule is a new request.
export interface ChildEgressRequestShape {
  host: string;
  port?: number;
  method: string;
  path: string;
}

const hostOf = (rule: { host: string }): string =>
  rule.host.trim().toLowerCase();

const shapeOf = (rule: ChildEgressRuleSeed): ChildEgressRequestShape => ({
  host: hostOf(rule),
  ...(rule.port !== undefined ? { port: rule.port } : {}),
  method: rule.method ?? "*",
  path: rule.pathPattern ?? "*",
});

const sameRequest = (
  a: ChildEgressRequestShape,
  b: ChildEgressRequestShape,
): boolean =>
  hostOf(a) === b.host &&
  a.port === b.port &&
  a.method === b.method &&
  a.path === b.path;

// UNIT_BOUNDARY_DESCRIPTION: whether a rule the owner approved on the child gives what the driver asks: an allow, for the same host and port, and a method and path that are the asked ones or any, so the owner's host-wide approval covers every path on it, one for GET /api/* does not cover POST /other/*, and a block never covers anything.
const covers = (row: EgressRuleRow, asked: ChildEgressRequestShape): boolean =>
  row.verdict === "allow" &&
  hostOf(row) === asked.host &&
  row.port === asked.port &&
  (row.method === "*" || row.method === asked.method) &&
  (row.pathPattern === "*" || row.pathPattern === asked.path);

// UNIT_BOUNDARY_DESCRIPTION: which of an open child's rules a driver's new rules replace besides its own: the owner's approvals of what a driver asked, an allow from the inbox, and any wildcard allow, each kept while the driver still asks for it. A block, a deny on the child that the driver did not write (the owner's, from the inbox or by hand), is the owner's alone: no driver revokes it, and a driver's allow it would lose to at the gate is neither written nor asked of the owner again, only reported back as blocked.
const isOwnerBlock = (row: EgressRuleRow): boolean =>
  row.verdict !== "allow" && row.source !== CHILD_DRIVER_SOURCE;

const answersADriverAsk = (row: EgressRuleRow): boolean =>
  row.verdict === "allow" &&
  (row.source === "inbox" || isWildcardEgressRule(row));

// UNIT_BOUNDARY_DESCRIPTION: the rules a child whose egress is its own starts with, written as its launching agent's: an open child's are the ones the launching agent set, and can be replaced by it, except a rule the launching agent may not give, which waits for the owner's approval and goes when the launching agent drops it, while a block the owner set on the child stays whatever the launching agent sets: an allow rule to a wildcard host, always, and one to a host the launching agent's own rules (as they are at that moment) do not reach, unless the owner lets the launching agent's root give its children network access of their own. A scoped child's are a copy, made once at launch, of the rules its parent's requests are decided under (the parent's root's, or the parent's own when it is itself detached) for the hosts named, or all of them. Nothing here follows the parent afterwards.
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
      const current = await deps.repo.listForAgent(agentId);
      const blocks = current.filter(isOwnerBlock);
      const blockedByOwner = (rule: ChildEgressRuleSeed): boolean =>
        rule.verdict === "allow" &&
        blocks.some((block) =>
          allowBeatsBlock(
            {
              host: rule.host,
              ...(rule.port !== undefined ? { port: rule.port } : {}),
              method: rule.method ?? "*",
              pathPattern: rule.pathPattern ?? "*",
            },
            block,
          ),
        );
      const settable = rules.filter((rule) => !blockedByOwner(rule));
      const askFor = await askOf(decidedBy, settable);
      const asked = settable
        .map((rule) => ({ rule, ask: askFor(rule) }))
        .filter(
          (r): r is { rule: ChildEgressRuleSeed; ask: "wildcard" | "wider" } =>
            r.ask !== null,
        );
      const askedShapes = asked.map(({ rule }) => shapeOf(rule));
      const kept: EgressRuleRow[] = [];
      for (const row of current) {
        if (row.source === CHILD_DRIVER_SOURCE) {
          await deps.repo.revoke(row.id);
          continue;
        }
        if (!answersADriverAsk(row)) continue;
        if (askedShapes.some((shape) => covers(row, shape))) kept.push(row);
        else await deps.repo.revoke(row.id);
      }
      const granted = (rule: ChildEgressRuleSeed): boolean =>
        kept.some((row) => covers(row, shapeOf(rule)));
      const stillAsked = asked
        .filter(({ rule }) => !granted(rule))
        .map(({ rule }) => shapeOf(rule));
      await deps.ownerEgress.withdraw(agentId, (request) =>
        stillAsked.some((shape) => sameRequest(request, shape)),
      );
      const waiting: { host: string; id: string }[] = [];
      for (const rule of settable) {
        const ask = askFor(rule);
        if (!ask) {
          await write(agentId, decidedBy, CHILD_DRIVER_SOURCE, rule);
          continue;
        }
        if (granted(rule)) continue;
        const { id } = await deps.ownerEgress.request({
          childId: agentId,
          driverId: decidedBy,
          rule,
          ask,
        });
        waiting.push({ host: hostOf(rule), id });
      }
      const blocked = rules
        .filter(blockedByOwner)
        .map((rule) => ({ host: hostOf(rule) }));
      if (blocked.length > 0)
        getLogger().info(
          { agentId, driverId: decidedBy, hosts: blocked.map((b) => b.host) },
          "egress: a driver's allow rules on its open child lost to the owner's blocks there, and were not written",
        );
      return { waiting, blocked };
    },
  };
}
