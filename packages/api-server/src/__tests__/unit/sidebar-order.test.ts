// TEST_OVERVIEW: the sidebar keeps, per user, the order the user dragged the Agents into, and the order of the Sessions in each Agent's list. Setting a list replaces it whole and keeps each id once. One Agent's Session order never touches another's, and one user's order never touches another user's.
import { describe, expect, it } from "vitest";

import type { SidebarOrderRepository } from "../../modules/sidebar-order/infrastructure/sidebar-order-repository.js";
import { createSidebarOrderService } from "../../modules/sidebar-order/services/sidebar-order-service.js";

function memoryRepo(): SidebarOrderRepository {
  const agents = new Map<string, string[]>();
  const sessions = new Map<string, Map<string, string[]>>();
  return {
    async find(owner) {
      return {
        agents: [...(agents.get(owner) ?? [])],
        sessions: Object.fromEntries(
          [...(sessions.get(owner) ?? new Map<string, string[]>())].filter(
            ([, ids]) => ids.length > 0,
          ),
        ),
      };
    },
    async replaceAgents(owner, agentIds) {
      agents.set(owner, [...agentIds]);
    },
    async replaceSessions(owner, agentId, sessionIds) {
      const byAgent = sessions.get(owner) ?? new Map<string, string[]>();
      byAgent.set(agentId, [...sessionIds]);
      sessions.set(owner, byAgent);
    },
    async listAgentIds() {
      return [];
    },
    async deleteForAgent() {},
  };
}

describe("sidebar order", () => {
  it("starts empty", async () => {
    const order = createSidebarOrderService({
      repo: memoryRepo(),
      owner: "u1",
    });
    expect(await order.get()).toEqual({ agents: [], sessions: {} });
  });

  // TEST_SCENARIO: a drag and drop sends the whole new order. The stored order is that order, and an id sent twice is kept once, at its first place.
  it("keeps the Agent order it was given, each Agent once", async () => {
    const order = createSidebarOrderService({
      repo: memoryRepo(),
      owner: "u1",
    });
    await order.setAgents(["b", "a"]);
    expect((await order.setAgents(["c", "a", "c", "b"])).agents).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect((await order.setAgents([])).agents).toEqual([]);
  });

  // TEST_SCENARIO: Sessions are ordered within their own Agent's list. Reordering one Agent's Sessions leaves every other Agent's list as it was.
  it("scopes the Session order to its Agent", async () => {
    const order = createSidebarOrderService({
      repo: memoryRepo(),
      owner: "u1",
    });
    await order.setSessions("a", ["s1", "s2"]);
    await order.setSessions("b", ["s3"]);
    const after = await order.setSessions("a", ["s2", "s1", "s2"]);
    expect(after.sessions).toEqual({ a: ["s2", "s1"], b: ["s3"] });
  });

  it("keeps each user's order apart", async () => {
    const repo = memoryRepo();
    const mine = createSidebarOrderService({ repo, owner: "u1" });
    const theirs = createSidebarOrderService({ repo, owner: "u2" });
    await mine.setAgents(["a"]);
    await mine.setSessions("a", ["s1"]);
    expect(await theirs.get()).toEqual({ agents: [], sessions: {} });
  });
});
