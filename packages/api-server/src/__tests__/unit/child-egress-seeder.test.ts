// TEST_OVERVIEW: a child whose egress is its own starts with its rules written as its launching agent's: an open child with the rules the launching agent set, which it can replace; a scoped child with a copy of the rules its parent's requests are decided under, for the hosts named or all of them, copied once.
import { describe, expect, it } from "vitest";
import type { EgressRuleRow } from "../../modules/egress-rules/domain/types.js";
import type { EgressRulesRepository } from "../../modules/egress-rules/infrastructure/egress-rules-repository.js";
import { createChildEgressSeeder } from "../../modules/egress-rules/services/child-egress-seeder.js";
import { createEgressRuleWriter } from "../../modules/egress-rules/services/egress-rule-writer.js";

function rule(agentId: string, host: string): EgressRuleRow {
  return {
    id: `${agentId}:${host}`,
    agentId,
    host,
    method: "*",
    pathPattern: "*",
    verdict: "allow",
    decidedBy: "user-1",
    decidedAt: new Date(0),
    status: "active",
    source: "manual",
  };
}

function setup(initial: EgressRuleRow[]) {
  const rows = [...initial];
  const requested: string[] = [];
  const withdrawn: string[][] = [];
  const repo = {
    listForAgent: async (agentId: string) =>
      rows.filter((r) => r.agentId === agentId && r.status === "active"),
    insert: async (input: EgressRuleRow) => {
      const row = {
        ...input,
        decidedAt: new Date(0),
        status: "active" as const,
      };
      rows.push(row);
      return row;
    },
    revoke: async (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.status = "revoked";
    },
    listActiveForPromotionScan: async () => [],
  } as unknown as EgressRulesRepository;
  const seeder = createChildEgressSeeder({
    repo,
    writer: createEgressRuleWriter({
      repo,
      l7Hosts: { get: async () => [], set: async () => {} },
    } as unknown as Parameters<typeof createEgressRuleWriter>[0]),
    rulesOwnerOf: async () => "agent-root",
    wildcardEgress: {
      request: async ({ rule }) => {
        requested.push(rule.host);
        return { id: `request:${rule.host}` };
      },
      withdraw: async (_childId, keep) => {
        withdrawn.push([...keep].sort());
      },
    },
  });
  const hostsOf = (agentId: string) =>
    rows
      .filter((r) => r.agentId === agentId && r.status === "active")
      .map((r) => `${r.host}:${r.source}`)
      .sort();
  const approve = (agentId: string, host: string) =>
    rows.push({ ...rule(agentId, host), source: "inbox" });
  return { seeder, hostsOf, requested, withdrawn, approve };
}

describe("a detached child's first rules", () => {
  // TEST_SCENARIO: a scoped child copies its parent's rules for the hosts named, and only those, written as inherited, so a later change of the parent's rules leaves the child's copy as it was.
  it("copies the named hosts of the parent's rules onto a scoped child", async () => {
    const { seeder, hostsOf } = setup([
      rule("agent-root", "github.com"),
      rule("agent-root", "registry.npmjs.org"),
    ]);
    await seeder.seed("agent-child", {
      parentAgentId: "agent-driver",
      connectionsFrom: "none",
      egressFrom: "scoped",
      egressSeed: { hosts: ["github.com"] },
    });
    expect(hostsOf("agent-child")).toEqual(["github.com:inherited"]);
  });

  // TEST_SCENARIO: an allow rule to a wildcard host, from * to *.github.com, is never written for the launching agent: it waits as a request its owner decides, while a wildcard deny and a plain host are the launching agent's to set. An approved one stays while the launching agent keeps asking for it, and goes when it drops it, with any request still waiting.
  it("holds an open child's wildcard allow rule for its owner", async () => {
    const { seeder, hostsOf, requested, withdrawn, approve } = setup([]);
    await seeder.seed("agent-child", {
      parentAgentId: "agent-driver",
      connectionsFrom: "none",
      egressFrom: "open",
      egressSeed: {
        rules: [
          { host: "*", verdict: "allow" },
          { host: "*.com", verdict: "allow" },
          { host: "*.github.com", verdict: "allow" },
          { host: "github.com", verdict: "allow" },
          { host: "*", verdict: "deny" },
        ],
      },
    });
    expect(hostsOf("agent-child")).toEqual(["*:driver", "github.com:driver"]);
    expect(requested).toEqual(["*", "*.com", "*.github.com"]);

    approve("agent-child", "*");
    const kept = await seeder.setOpenRules("agent-child", "agent-driver", [
      { host: "*", verdict: "allow" },
      { host: "pypi.org", verdict: "allow" },
    ]);
    expect(kept.waiting).toEqual([]);
    expect(hostsOf("agent-child")).toEqual(["*:inbox", "pypi.org:driver"]);

    const dropped = await seeder.setOpenRules("agent-child", "agent-driver", [
      { host: "pypi.org", verdict: "allow" },
    ]);
    expect(dropped.waiting).toEqual([]);
    expect(hostsOf("agent-child")).toEqual(["pypi.org:driver"]);
    expect(withdrawn.at(-1)).toEqual([]);
  });
});
