import { describe, it, expect } from "vitest";
import { reconcileL7Promotions } from "../../modules/egress-rules/services/l7-promotion-reconcile.js";

/**
 * The reconcile's contract: one rule scan + one agent list, diff in memory,
 * write only the agents whose spec.l7Hosts drifted from the projection of
 * their active narrow rules. A converged fleet issues zero writes; an agent
 * whose narrowing was revoked but whose clear-patch failed (present in the
 * agent list, absent from the rule scan) is demoted.
 */

/** A narrow (method-specific) manual rule — the shape
 *  `listActiveForPromotionScan` returns; `promotedHosts` keeps it. */
function rule(agentId: string, host: string) {
  return {
    agentId,
    host,
    method: "GET",
    pathPattern: "/x",
    source: "manual",
  };
}
type ScanRule = ReturnType<typeof rule>;

function harness(opts: {
  rules: ScanRule[];
  agents: Array<{ agentId: string; current: string[] }>;
}) {
  const sets: Array<{ agentId: string; hosts: readonly string[] }> = [];
  return {
    sets,
    run: () =>
      reconcileL7Promotions({
        repo: { listActiveForPromotionScan: async () => opts.rules },
        listAgentL7State: async () => opts.agents,
        l7Hosts: {
          set: async (agentId, hosts) => {
            sets.push({ agentId, hosts });
          },
        },
        log: () => {},
      }),
  };
}

describe("reconcileL7Promotions", () => {
  it("writes nothing when every agent already matches its projection", async () => {
    const h = harness({
      rules: [rule("a", "api.example.com")],
      agents: [
        { agentId: "a", current: ["api.example.com"] },
        { agentId: "b", current: [] },
      ],
    });
    const res = await h.run();
    expect(h.sets).toEqual([]);
    expect(res).toEqual({ scanned: 2, drifted: 0, failed: 0 });
  });

  it("promotes an agent whose projected host is missing from the CR", async () => {
    const h = harness({
      rules: [rule("a", "api.example.com")],
      agents: [{ agentId: "a", current: [] }],
    });
    const res = await h.run();
    expect(h.sets).toEqual([{ agentId: "a", hosts: ["api.example.com"] }]);
    expect(res.drifted).toBe(1);
  });

  it("demotes an agent with a stale host and no active narrowing rule", async () => {
    const h = harness({
      rules: [],
      agents: [{ agentId: "a", current: ["stale.example.com"] }],
    });
    const res = await h.run();
    expect(h.sets).toEqual([{ agentId: "a", hosts: [] }]);
    expect(res.drifted).toBe(1);
  });

  it("touches only the drifted agent in a mixed fleet", async () => {
    const h = harness({
      rules: [rule("a", "a.example.com"), rule("b", "b.example.com")],
      agents: [
        { agentId: "a", current: ["a.example.com"] }, // converged
        { agentId: "b", current: [] }, // drifted (missing)
        { agentId: "c", current: ["ghost.example.com"] }, // drifted (stale)
      ],
    });
    const res = await h.run();
    expect(h.sets.map((s) => s.agentId).sort()).toEqual(["b", "c"]);
    expect(res).toEqual({ scanned: 3, drifted: 2, failed: 0 });
  });

  it("isolates a per-agent write failure and counts it", async () => {
    const sets: string[] = [];
    const res = await reconcileL7Promotions({
      repo: {
        listActiveForPromotionScan: async () => [rule("a", "a.example.com")],
      },
      listAgentL7State: async () => [
        { agentId: "a", current: [] },
        { agentId: "b", current: ["ghost.example.com"] },
      ],
      l7Hosts: {
        set: async (agentId) => {
          if (agentId === "a") throw new Error("patch conflict");
          sets.push(agentId);
        },
      },
      log: () => {},
    });
    expect(res).toEqual({ scanned: 2, drifted: 2, failed: 1 });
    expect(sets).toEqual(["b"]); // b still reconciled despite a's failure
  });

  it("reports a failed scan as one failure without touching agents", async () => {
    const sets: string[] = [];
    const res = await reconcileL7Promotions({
      repo: {
        listActiveForPromotionScan: async () => {
          throw new Error("db down");
        },
      },
      listAgentL7State: async () => [{ agentId: "a", current: [] }],
      l7Hosts: { set: async (id) => void sets.push(id) },
      log: () => {},
    });
    expect(res).toEqual({ scanned: 0, drifted: 0, failed: 1 });
    expect(sets).toEqual([]);
  });
});
