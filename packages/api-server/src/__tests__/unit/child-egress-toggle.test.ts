// TEST_OVERVIEW: the owner's toggle that lets an Agent's sub-agents and Environments have network access of their own, wider than the Agent's: the owner reads and switches it on a root Agent with the Environments feature, it reads unavailable elsewhere, and approving a child's rule that reaches past its driver turns it on for the driver's launch root, while a wildcard approval leaves it as it was. A child's waiting request is one per host, port, method and path.
import { describe, expect, it } from "vitest";

import { configureLogger } from "../../core/logger.js";
import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createApprovalsService } from "../../modules/approvals/services/approvals-service.js";
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
  const written: { agentId: string; host: string; pathPattern: string }[] = [];
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
  } as Partial<ApprovalsRepository> as ApprovalsRepository;
  const requests = createChildEgressRequests({
    repo,
    ownerOf: async () => "alice",
    nameOf: async (id) => id,
  });
  const approvals = createApprovalsService({
    repo,
    egressRuleWriter: {
      insert: async (input) => {
        written.push(input);
        return {
          kind: "inserted",
          row: { id: input.id, verdict: input.verdict, source: "inbox" },
        };
      },
    },
    wrapperFrameSender: { send: async () => {} },
    isAgentOwnedBy: async () => true,
    ownerSub: "alice",
    actor: "alice",
    actorEmail: null,
    agentBinding: "*",
    childEgressGrants: {
      grantForRootOf: async (driverId) => {
        granted.push(driverId);
      },
    },
  });
  return { requests, approvals, rows, written, granted };
}

describe("approving a child's rule wider than its driver", () => {
  // TEST_SCENARIO: the owner allows the first wider rule a driver asks for: the rule the driver asked for, its path included, is written onto the child alone, and the driver's launch root gets the toggle, so the next child needs no approval.
  it("writes the rule onto the child and turns the toggle on", async () => {
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
    expect(w.written).toMatchObject([
      { agentId: "agent-child", host: "pypi.org", pathPattern: "/simple/*" },
    ]);
    expect(w.granted).toEqual(["agent-driver"]);
  });

  // TEST_SCENARIO: a wildcard rule is the owner's to approve each time, so approving one writes it and leaves the toggle alone; a declined wider rule turns nothing on.
  it("leaves the toggle alone for a wildcard or a decline", async () => {
    const w = approvalsWorld();
    const wildcard = await w.requests.request({
      childId: "agent-child",
      driverId: "agent-driver",
      rule: { host: "*", verdict: "allow" },
      ask: "wildcard",
    });
    await w.approvals.approvePermanent(wildcard.id);
    const wider = await w.requests.request({
      childId: "agent-child",
      driverId: "agent-driver",
      rule: { host: "pypi.org", verdict: "allow" },
      ask: "wider",
    });
    await w.approvals.dismiss(wider.id);
    expect(w.written.map((r) => r.host)).toEqual(["*"]);
    expect(w.granted).toEqual([]);
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
