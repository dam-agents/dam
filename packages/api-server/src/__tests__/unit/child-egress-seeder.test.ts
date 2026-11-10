// TEST_OVERVIEW: a child whose egress is its own starts with its rules written as its launching agent's: an open child with the rules the launching agent set, which it can replace, except those that wait for the owner (a wildcard allow, or a host the launching agent does not reach while its owner has not let its children have network access of their own); a scoped child with a copy of the rules its parent's requests are decided under, for the hosts named or all of them, copied once.
import { describe, expect, it } from "vitest";
import type { EgressRuleRow } from "../../modules/egress-rules/domain/types.js";
import type { EgressRulesRepository } from "../../modules/egress-rules/infrastructure/egress-rules-repository.js";
import { createChildEgressSeeder } from "../../modules/egress-rules/services/child-egress-seeder.js";
import { createEgressRuleWriter } from "../../modules/egress-rules/services/egress-rule-writer.js";

function rule(
  agentId: string,
  host: string,
  overrides: Partial<EgressRuleRow> = {},
): EgressRuleRow {
  return {
    id: `${agentId}:${host}:${overrides.verdict ?? "allow"}:${overrides.pathPattern ?? "*"}`,
    agentId,
    host,
    method: "*",
    pathPattern: "*",
    verdict: "allow",
    decidedBy: "user-1",
    decidedAt: new Date(0),
    status: "active",
    source: "manual",
    ...overrides,
  };
}

function setup(
  initial: EgressRuleRow[],
  opts: { granted?: boolean } = { granted: true },
) {
  const rows = [...initial];
  const requested: string[] = [];
  const asks: string[] = [];
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
  const open = new Set<string>();
  const seeder = createChildEgressSeeder({
    repo,
    writer: createEgressRuleWriter({
      repo,
      l7Hosts: { get: async () => [], set: async () => {} },
    } as unknown as Parameters<typeof createEgressRuleWriter>[0]),
    rulesOwnerOf: async () => "agent-root",
    ownEgressGranted: async () => opts.granted ?? false,
    ownerEgress: {
      request: async ({ rule, ask }) => {
        requested.push(rule.host);
        asks.push(`${rule.host}:${ask}`);
        open.add(rule.host);
        return { id: `request:${rule.host}` };
      },
      withdraw: async (_childId, keep) => {
        for (const host of open) if (!keep({ host })) open.delete(host);
        withdrawn.push([...open].sort());
      },
    },
  });
  const hostsOf = (agentId: string) =>
    rows
      .filter((r) => r.agentId === agentId && r.status === "active")
      .map((r) => `${r.host}:${r.source}`)
      .sort();
  const approve = (agentId: string, host: string) => {
    open.delete(host);
    rows.push({ ...rule(agentId, host), source: "inbox" });
  };
  return { seeder, hostsOf, requested, asks, withdrawn, approve };
}

const openChild = (rules: { host: string; verdict: "allow" | "deny" }[]) => ({
  parentAgentId: "agent-driver",
  connectionsFrom: "none" as const,
  egressFrom: "open" as const,
  egressSeed: { rules },
});

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
    await seeder.seed(
      "agent-child",
      openChild([
        { host: "*", verdict: "allow" },
        { host: "*.com", verdict: "allow" },
        { host: "*.github.com", verdict: "allow" },
        { host: "github.com", verdict: "allow" },
        { host: "*", verdict: "deny" },
      ]),
    );
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

describe("an open child wider than its driver", () => {
  // TEST_SCENARIO: with the owner's toggle off, a driver that reaches only github.com cannot give its child pypi.org: that rule waits for the owner like a wildcard does, while github.com, which the driver reaches itself, and a deny, which narrows, are written at once.
  it("holds a rule to a host the driver does not reach while the toggle is off", async () => {
    const { seeder, hostsOf, asks } = setup(
      [rule("agent-root", "github.com")],
      { granted: false },
    );
    await seeder.seed(
      "agent-child",
      openChild([
        { host: "github.com", verdict: "allow" },
        { host: "pypi.org", verdict: "allow" },
        { host: "evil.example", verdict: "deny" },
      ]),
    );
    expect(hostsOf("agent-child")).toEqual([
      "evil.example:driver",
      "github.com:driver",
    ]);
    expect(asks).toEqual(["pypi.org:wider"]);
  });

  // TEST_SCENARIO: the driver's wildcard rule reaches the hosts under it, so a child may name one of them; a deny the driver holds for one host stops the child from reaching it through the driver's wider allow.
  it("compares with the driver's rules as the gate reads them", async () => {
    const { seeder, hostsOf, asks } = setup(
      [
        rule("agent-root", "*.github.com"),
        rule("agent-root", "gist.github.com", { verdict: "deny" }),
      ],
      { granted: false },
    );
    await seeder.seed(
      "agent-child",
      openChild([
        { host: "api.github.com", verdict: "allow" },
        { host: "gist.github.com", verdict: "allow" },
      ]),
    );
    expect(hostsOf("agent-child")).toEqual(["api.github.com:driver"]);
    expect(asks).toEqual(["gist.github.com:wider"]);
  });

  // TEST_SCENARIO: once the owner turned the toggle on, the driver gives its child any plain host at once; a wildcard allow still waits for the owner each time.
  it("writes a wider rule at once with the toggle on, but never a wildcard", async () => {
    const { seeder, hostsOf, asks } = setup(
      [rule("agent-root", "github.com")],
      { granted: true },
    );
    await seeder.seed(
      "agent-child",
      openChild([
        { host: "pypi.org", verdict: "allow" },
        { host: "*", verdict: "allow" },
      ]),
    );
    expect(hostsOf("agent-child")).toEqual(["pypi.org:driver"]);
    expect(asks).toEqual(["*:wildcard"]);
  });

  // TEST_SCENARIO: replacing a running child's rules with update_subagent_egress runs the same check as at launch: a wider rule waits; once the owner approves it, it stays while the driver keeps asking for it, and goes, with its waiting request, when the driver drops it.
  it("checks update_subagent_egress the same way", async () => {
    const { seeder, hostsOf, approve } = setup(
      [rule("agent-root", "github.com")],
      { granted: false },
    );
    await seeder.seed("agent-child", openChild([]));
    const asked = await seeder.setOpenRules("agent-child", "agent-driver", [
      { host: "github.com", verdict: "allow" },
      { host: "pypi.org", verdict: "allow" },
    ]);
    expect(asked.waiting).toEqual([
      { host: "pypi.org", id: "request:pypi.org" },
    ]);
    expect(hostsOf("agent-child")).toEqual(["github.com:driver"]);

    approve("agent-child", "pypi.org");
    const kept = await seeder.setOpenRules("agent-child", "agent-driver", [
      { host: "pypi.org", verdict: "allow" },
    ]);
    expect(kept.waiting).toEqual([]);
    expect(hostsOf("agent-child")).toEqual(["pypi.org:inbox"]);

    await seeder.setOpenRules("agent-child", "agent-driver", []);
    expect(hostsOf("agent-child")).toEqual([]);
  });
});
