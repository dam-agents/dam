// TEST_OVERVIEW: the sidebar keeps, per user, the order the user dragged the Agents into. Sessions have no stored order: the sidebar lists them by last activity. Setting the Agent order replaces it whole and keeps each id once, and one user's order never touches another user's.
import { describe, expect, it } from "vitest";

import type { SidebarOrderRepository } from "../../modules/sidebar-order/infrastructure/sidebar-order-repository.js";
import { createSidebarOrderService } from "../../modules/sidebar-order/services/sidebar-order-service.js";

function memoryRepo(): SidebarOrderRepository {
  const agents = new Map<string, string[]>();
  return {
    async find(owner) {
      return { agents: [...(agents.get(owner) ?? [])], sessions: {} };
    },
    async replaceAgents(owner, agentIds) {
      agents.set(owner, [...agentIds]);
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

  it("keeps each user's order apart", async () => {
    const repo = memoryRepo();
    const mine = createSidebarOrderService({ repo, owner: "u1" });
    const theirs = createSidebarOrderService({ repo, owner: "u2" });
    await mine.setAgents(["a"]);
    expect(await theirs.get()).toEqual({ agents: [], sessions: {} });
  });
});
