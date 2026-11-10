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
  const open = new Map<
    string,
    { host: string; port?: number; method: string; path: string }
  >();
  const keyOf = (r: { host: string; method?: string; path?: string }) =>
    `${r.host} ${r.method ?? "*"} ${r.path ?? "*"}`;
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
        const shape = {
          host: rule.host,
          method: rule.method ?? "*",
          path: rule.pathPattern ?? "*",
        };
        open.set(keyOf(shape), shape);
        return { id: `request:${rule.host}` };
      },
      withdraw: async (_childId, keep) => {
        for (const [key, shape] of open) if (!keep(shape)) open.delete(key);
        withdrawn.push([...open.keys()].sort());
      },
    },
  });
  const hostsOf = (agentId: string) =>
    rows
      .filter((r) => r.agentId === agentId && r.status === "active")
      .map((r) => `${r.host}:${r.source}`)
      .sort();
  const approve = (
    agentId: string,
    host: string,
    shape: { method?: string; pathPattern?: string } = {},
  ) => {
    open.delete(keyOf({ host, method: shape.method, path: shape.pathPattern }));
    rows.push({ ...rule(agentId, host, shape), source: "inbox" });
  };
  const block = (
    agentId: string,
    host: string,
    shape: { pathPattern?: string; source?: "inbox" | "manual" } = {},
  ) => {
    rows.push({
      ...rule(agentId, host, {
        verdict: "deny",
        ...(shape.pathPattern !== undefined && {
          pathPattern: shape.pathPattern,
        }),
      }),
      source: shape.source ?? "inbox",
    });
  };
  const verdictsOf = (agentId: string) =>
    rows
      .filter((r) => r.agentId === agentId && r.status === "active")
      .map((r) => `${r.verdict} ${r.host} ${r.pathPattern}:${r.source}`)
      .sort();
  return {
    seeder,
    hostsOf,
    verdictsOf,
    requested,
    asks,
    withdrawn,
    approve,
    block,
  };
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

  // TEST_SCENARIO: the owner approved a rule for one method and path on a host; the driver then asks for another method and path on that host. That is a rule the owner never saw, so it waits for them as a new request, and the approved one, no longer asked for, goes; a host-wide approval, any method and path, covers whatever the driver asks on that host.
  it("asks again when the driver changes an approved rule's method or path", async () => {
    const { seeder, hostsOf, approve, withdrawn } = setup([], {
      granted: false,
    });
    await seeder.seed("agent-child", openChild([]));
    const get = {
      host: "*.example.com",
      method: "GET",
      pathPattern: "/api/*",
      verdict: "allow" as const,
    };
    await seeder.setOpenRules("agent-child", "agent-driver", [get]);
    approve("agent-child", "*.example.com", {
      method: "GET",
      pathPattern: "/api/*",
    });

    const changed = await seeder.setOpenRules("agent-child", "agent-driver", [
      { ...get, method: "POST", pathPattern: "/other/*" },
    ]);
    expect(changed.waiting).toEqual([
      { host: "*.example.com", id: "request:*.example.com" },
    ]);
    expect(hostsOf("agent-child")).toEqual([]);
    expect(withdrawn.at(-1)).toEqual([]);

    approve("agent-child", "*.example.com");
    const covered = await seeder.setOpenRules("agent-child", "agent-driver", [
      { ...get, method: "DELETE", pathPattern: "/any/*" },
    ]);
    expect(covered.waiting).toEqual([]);
    expect(hostsOf("agent-child")).toEqual(["*.example.com:inbox"]);
  });
});

describe("an owner's block on an open child", () => {
  // TEST_SCENARIO: the owner blocked a host on the child from a prompt, and once more by hand; the driver then replaces the child's rules, with an allow for that host and without one. Each time both blocks stay, the allow is neither written nor asked of the owner, and the driver is told it was blocked, so the driver cannot undo the owner's decision.
  it("stays the owner's, whatever the driver sets", async () => {
    const { seeder, verdictsOf, requested, block } = setup([], {
      granted: true,
    });
    await seeder.seed("agent-child", openChild([]));
    block("agent-child", "evil.example");
    block("agent-child", "gist.github.com", { source: "manual" });

    const tried = await seeder.setOpenRules("agent-child", "agent-driver", [
      { host: "evil.example", verdict: "allow" },
      { host: "gist.github.com", verdict: "allow" },
      { host: "github.com", verdict: "allow" },
    ]);
    expect(tried).toEqual({
      waiting: [],
      blocked: [{ host: "evil.example" }, { host: "gist.github.com" }],
    });
    expect(requested).toEqual([]);
    expect(verdictsOf("agent-child")).toEqual([
      "allow github.com *:driver",
      "deny evil.example *:inbox",
      "deny gist.github.com *:manual",
    ]);

    await seeder.setOpenRules("agent-child", "agent-driver", []);
    expect(verdictsOf("agent-child")).toEqual([
      "deny evil.example *:inbox",
      "deny gist.github.com *:manual",
    ]);
  });

  // TEST_SCENARIO: with the toggle off, the owner's block on a host the driver does not reach is not an approval of it: the driver's allow is not counted as granted, and since the block would lose to it at the gate, it is not written; asking the owner again for what they blocked is not the driver's to do either.
  it("never counts as an approval of the driver's allow", async () => {
    const { seeder, verdictsOf, requested, block } = setup(
      [rule("agent-root", "github.com")],
      { granted: false },
    );
    await seeder.seed("agent-child", openChild([]));
    block("agent-child", "pypi.org");
    const tried = await seeder.setOpenRules("agent-child", "agent-driver", [
      { host: "pypi.org", verdict: "allow" },
    ]);
    expect(tried).toEqual({ waiting: [], blocked: [{ host: "pypi.org" }] });
    expect(requested).toEqual([]);
    expect(verdictsOf("agent-child")).toEqual(["deny pypi.org *:inbox"]);
  });

  // TEST_SCENARIO: a driver cannot get round a host-wide block with an allow the gate ranks first, a named path or method; a block of one path leaves the driver's allow for another path of the host, and a block's own path, `/*` as much as `*`, speaks for every path; the driver's own deny is still the driver's to drop.
  it("stops the allows the gate would let past it", async () => {
    const { seeder, verdictsOf, block } = setup([], { granted: true });
    await seeder.seed("agent-child", openChild([]));
    block("agent-child", "evil.example", { pathPattern: "/*" });
    block("agent-child", "api.github.com", { pathPattern: "/admin/*" });
    const tried = await seeder.setOpenRules("agent-child", "agent-driver", [
      { host: "evil.example", verdict: "allow", pathPattern: "/upload/*" },
      { host: "evil.example", verdict: "allow", method: "POST" },
      { host: "api.github.com", verdict: "allow", pathPattern: "/repos/*" },
      { host: "api.github.com", verdict: "allow", pathPattern: "/admin/x/*" },
      { host: "pypi.org", verdict: "deny" },
    ]);
    expect(tried.blocked).toEqual([
      { host: "evil.example" },
      { host: "evil.example" },
      { host: "api.github.com" },
    ]);
    expect(verdictsOf("agent-child")).toEqual([
      "allow api.github.com /repos/*:driver",
      "deny api.github.com /admin/*:inbox",
      "deny evil.example /*:inbox",
      "deny pypi.org *:driver",
    ]);
    await seeder.setOpenRules("agent-child", "agent-driver", []);
    expect(verdictsOf("agent-child")).toEqual([
      "deny api.github.com /admin/*:inbox",
      "deny evil.example /*:inbox",
    ]);
  });

  // TEST_SCENARIO: the owner wrote a block of `*` on the child by hand. The driver cannot ask for any host again, but its allow for a host it reaches itself is still written: the gate ranks a named host before `*`, so the block says "not any host", not "no host".
  it("of a wildcard stops that wildcard, not the hosts under it", async () => {
    const { seeder, verdictsOf, requested, block } = setup(
      [rule("agent-root", "github.com")],
      { granted: false },
    );
    await seeder.seed("agent-child", openChild([]));
    block("agent-child", "*", { source: "manual" });
    const tried = await seeder.setOpenRules("agent-child", "agent-driver", [
      { host: "*", verdict: "allow" },
      { host: "github.com", verdict: "allow" },
    ]);
    expect(tried).toEqual({ waiting: [], blocked: [{ host: "*" }] });
    expect(requested).toEqual([]);
    expect(verdictsOf("agent-child")).toEqual([
      "allow github.com *:driver",
      "deny * *:manual",
    ]);
  });
});
