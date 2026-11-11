// TEST_OVERVIEW: the owner's toggle that lets an Agent's sub-agents and Environments have network access of their own, wider than the Agent's: the owner reads and switches it on a root Agent with the Environments feature, it reads unavailable elsewhere, approving a child's rule that is wider than its driver writes that one rule and leaves it as it was, the owner's explicit approval for all children turns it on for the driver's launch root, and turning it on writes every rule that waits for it. A child's waiting request is one per host, port, method and path.
import { describe, expect, it } from "vitest";

import { configureLogger } from "../../core/logger.js";
import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createApprovalsService } from "../../modules/approvals/services/approvals-service.js";
import { createChildEgressRelease } from "../../modules/approvals/services/child-egress-release.js";
import { createChildEgressRequests } from "../../modules/approvals/services/child-egress-requests.js";
import type { EgressRulesRepository } from "../../modules/egress-rules/infrastructure/egress-rules-repository.js";
import { createEgressRulesService } from "../../modules/egress-rules/services/egress-rules-service.js";

configureLogger({ level: "error", write: () => {} });

function toggleService(opts: { available: boolean; owned?: boolean }) {
  const on = new Set<string>();
  const svc = createEgressRulesService({
    repo: {} as EgressRulesRepository,
    l7Hosts: { set: async () => {} } as never,
    trustedHosts: [],
    isAgentOwnedBy: async () => opts.owned ?? true,
    ownerSub: "alice",
    actor: "alice",
    resolveUserEmail: async () => null,
    childEgress: {
      available: async () => opts.available,
      isGranted: async (agentId) => on.has(agentId),
      set: async (agentId, value) => {
        if (value) on.add(agentId);
        else on.delete(agentId);
      },
    },
  });
  return { svc, on };
}

describe("the child egress toggle", () => {
  // TEST_SCENARIO: off by default; the owner switches it on and off again on a root Agent, with no one-time mode in between.
  it("is off by default and switches as the owner sets it", async () => {
    const { svc, on } = toggleService({ available: true });
    expect(await svc.childEgress("agent-a")).toEqual({ state: "off" });
    expect(await svc.setChildEgress("agent-a", true)).toEqual({ state: "on" });
    expect(on.has("agent-a")).toBe(true);
    expect(await svc.childEgress("agent-a")).toEqual({ state: "on" });
    await svc.setChildEgress("agent-a", false);
    expect(await svc.childEgress("agent-a")).toEqual({ state: "off" });
  });

  // TEST_SCENARIO: without the Environments feature, or on an Agent that is itself a child, the toggle reads unavailable and cannot be switched, so a child never grants its own children more than its root; an Agent the caller does not own reads unavailable too.
  it("is unavailable without the feature or on a child", async () => {
    const { svc, on } = toggleService({ available: false });
    expect(await svc.childEgress("agent-child")).toEqual({
      state: "unavailable",
    });
    await expect(svc.setChildEgress("agent-child", true)).rejects.toThrow(
      /follow the toggle/,
    );
    expect(on.size).toBe(0);

    const foreign = toggleService({ available: true, owned: false });
    expect(await foreign.svc.childEgress("agent-a")).toEqual({
      state: "unavailable",
    });
    await expect(foreign.svc.setChildEgress("agent-a", true)).rejects.toThrow(
      /not found/,
    );
  });
});

function approvalsWorld() {
  const rows: PendingApprovalRow[] = [];
  const written: {
    agentId: string;
    host: string;
    pathPattern: string;
    source: string;
  }[] = [];
  const blockedHosts = new Set<string>();
  const granted: string[] = [];
  const repo = {
    insertPending: async (row) => {
      rows.push({
        ...row,
        createdAt: new Date(),
        resolvedAt: null,
        verdict: null,
        decidedBy: null,
        status: "pending",
        deliveredAt: null,
      });
      return true;
    },
    getPending: async (id) => rows.find((r) => r.id === id) ?? null,
    listPendingChildEgressRequests: async (childId) =>
      rows.filter((r) => r.agentId === childId && r.status === "pending"),
    resolvePending: async (id, verdict, decidedBy) => {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      Object.assign(row, { status: "resolved", verdict, decidedBy });
      return true;
    },
    listPendingWiderChildEgressRequests: async () =>
      rows.filter(
        (r) =>
          r.status === "pending" &&
          r.payload.kind === "egress_proposal" &&
          r.payload.widerThanDriver === true,
      ),
    expirePending: async (id) => {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      row.status = "expired";
      return true;
    },
  } as Partial<ApprovalsRepository> as ApprovalsRepository;
  const requests = createChildEgressRequests({
    repo,
    ownerOf: async () => "alice",
    nameOf: async (id) => id,
    isEnvironment: async () => false,
  });
  const egressRuleWriter: Parameters<
    typeof createApprovalsService
  >[0]["egressRuleWriter"] = {
    insert: async (input) => {
      if (blockedHosts.has(input.host))
        return {
          kind: "verdict-clash",
          existing: { id: "block", verdict: "deny", source: "manual" },
        };
      written.push(input);
      return {
        kind: "inserted",
        row: { id: input.id, verdict: input.verdict, source: input.source },
      };
    },
  };
  const rootOf = async (agentId: string) =>
    agentId === "agent-other" ? "agent-other-root" : "agent-root";
  const release = createChildEgressRelease({
    repo,
    writer: egressRuleWriter,
    rootOf,
  });
  const approvals = createApprovalsService({
    repo,
    egressRuleWriter,
    webSearchRuleWriter: { write: async () => {} },
    wrapperFrameSender: { send: async () => {} },
    isAgentOwnedBy: async () => true,
    ownerSub: "alice",
    actor: "alice",
    actorEmail: null,
    agentBinding: "*",
    childEgressSwitch: {
      turnOnForRootOf: async (driverId, decidedBy) => {
        granted.push(driverId);
        await release.release((await rootOf(driverId))!, decidedBy);
      },
    },
  });
  return { requests, approvals, release, rows, written, granted, blockedHosts };
}

describe("approving a child's rule wider than its driver", () => {
  // TEST_SCENARIO: the owner allows one wider rule a driver asks for: the rule the driver asked for, its path included, is written onto the child alone as the owner's, and the switch stays as it was, so the driver's next wider rule asks again. A wildcard approval and a decline leave the switch alone too.
  it("writes that one rule and leaves the switch alone", async () => {
    const w = approvalsWorld();
    const { id } = await w.requests.request({
      childId: "agent-child",
      driverId: "agent-driver",
      rule: { host: "pypi.org", verdict: "allow", pathPattern: "/simple/*" },
      ask: "wider",
    });
    expect(w.rows[0]!.payload).toMatchObject({
      kind: "egress_proposal",
      host: "pypi.org",
      path: "/simple/*",
      forAgentId: "agent-driver",
      widerThanDriver: true,
    });
    await w.approvals.approvePermanent(id);
    const wildcard = await w.requests.request({
      childId: "agent-child",
      driverId: "agent-driver",
      rule: { host: "*", verdict: "allow" },
      ask: "wildcard",
    });
    await w.approvals.approvePermanent(wildcard.id);
    const declined = await w.requests.request({
      childId: "agent-child",
      driverId: "agent-driver",
      rule: { host: "npmjs.org", verdict: "allow" },
      ask: "wider",
    });
    await w.approvals.dismiss(declined.id);
    expect(w.written).toMatchObject([
      {
        agentId: "agent-child",
        host: "pypi.org",
        pathPattern: "/simple/*",
        source: "inbox",
      },
      { agentId: "agent-child", host: "*", source: "inbox" },
    ]);
    expect(w.granted).toEqual([]);
  });

  // TEST_SCENARIO: the owner approves a wider rule for all of the driver's sub-agents and Environments. The rule is written as the owner's, the switch of the driver's launch root turns on, and every other wider rule that waits under that root is written as its driver's and leaves the inbox. A wildcard request, a request under another root, and a rule the owner blocked on the child are not written; the blocked one is withdrawn.
  it("for all children turns the switch on and writes what waits for it", async () => {
    const w = approvalsWorld();
    const ask = (
      childId: string,
      driverId: string,
      host: string,
      kind: "wider" | "wildcard" = "wider",
    ) =>
      w.requests.request({
        childId,
        driverId,
        rule: { host, verdict: "allow" },
        ask: kind,
      });
    const first = await ask("agent-child", "agent-driver", "pypi.org");
    await ask("agent-child", "agent-driver", "npmjs.org");
    await ask("agent-env", "agent-driver", "crates.io");
    await ask("agent-child", "agent-driver", "blocked.example");
    await ask("agent-child", "agent-driver", "*.example.net", "wildcard");
    await ask("agent-elsewhere", "agent-other", "rubygems.org");
    w.blockedHosts.add("blocked.example");

    await w.approvals.approveForChildren(first.id);

    expect(w.granted).toEqual(["agent-driver"]);
    expect(
      w.written.map((r) => `${r.agentId} ${r.host} ${r.source}`).sort(),
    ).toEqual([
      "agent-child npmjs.org driver",
      "agent-child pypi.org inbox",
      "agent-env crates.io driver",
    ]);
    expect(
      w.rows.map(
        (r) =>
          `${r.payload.kind === "egress_proposal" ? r.payload.host : ""} ${r.status}`,
      ),
    ).toEqual([
      "pypi.org resolved",
      "npmjs.org resolved",
      "crates.io resolved",
      "blocked.example expired",
      "*.example.net pending",
      "rubygems.org pending",
    ]);
  });

  // TEST_SCENARIO: the explicit approval changes the Agent at the root of the launch chain, so a request that is not for a wider rule, such as a wildcard one, has no such action.
  it("for all children is not offered on a wildcard request", async () => {
    const w = approvalsWorld();
    const wildcard = await w.requests.request({
      childId: "agent-child",
      driverId: "agent-driver",
      rule: { host: "*", verdict: "allow" },
      ask: "wildcard",
    });
    expect(await w.approvals.approveForChildren(wildcard.id)).toMatchObject({
      outcome: "not_actionable",
    });
    expect(w.granted).toEqual([]);
    expect(w.written).toEqual([]);
  });
});

describe("a child's waiting requests", () => {
  // TEST_SCENARIO: asking again for the same rule finds the request already waiting, while another path on the same host is a rule the owner has not seen, so it waits as a request of its own, and approving it writes that path.
  it("are one per host, port, method and path", async () => {
    const w = approvalsWorld();
    const ask = (pathPattern: string) =>
      w.requests.request({
        childId: "agent-child",
        driverId: "agent-driver",
        rule: { host: "pypi.org", verdict: "allow", pathPattern },
        ask: "wider",
      });
    const simple = await ask("/simple/*");
    expect((await ask("/simple/*")).id).toBe(simple.id);
    const packages = await ask("/packages/*");
    expect(packages.id).not.toBe(simple.id);
    expect(w.rows.map((r) => r.payload)).toMatchObject([
      { path: "/simple/*" },
      { path: "/packages/*" },
    ]);

    await w.approvals.approvePermanent(packages.id);
    expect(w.written).toMatchObject([
      { agentId: "agent-child", host: "pypi.org", pathPattern: "/packages/*" },
    ]);
  });
});
