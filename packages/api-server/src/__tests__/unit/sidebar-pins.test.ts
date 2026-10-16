// TEST_OVERVIEW: the sidebar keeps, per user, the Agents pinned to its top and the Sessions pinned to the top of each Agent's list, in the order the user dragged them into. Setting a list replaces it whole and keeps each id once. One Agent's Session pins never touch another's, and one user's pins never touch another user's.
import { describe, expect, it } from "vitest";

import type { SidebarPinsRepository } from "../../modules/sidebar-pins/infrastructure/sidebar-pins-repository.js";
import { createSidebarPinsService } from "../../modules/sidebar-pins/services/sidebar-pins-service.js";

function memoryRepo(): SidebarPinsRepository {
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

describe("sidebar pins", () => {
  it("starts empty", async () => {
    const pins = createSidebarPinsService({ repo: memoryRepo(), owner: "u1" });
    expect(await pins.get()).toEqual({ agents: [], sessions: {} });
  });

  // TEST_SCENARIO: a drag and drop sends the whole new order. The stored order is that order, and an id sent twice is kept once, at its first place.
  it("keeps the Agent order it was given, each Agent once", async () => {
    const pins = createSidebarPinsService({ repo: memoryRepo(), owner: "u1" });
    await pins.setAgents(["b", "a"]);
    expect((await pins.setAgents(["c", "a", "c", "b"])).agents).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect((await pins.setAgents([])).agents).toEqual([]);
  });

  // TEST_SCENARIO: Sessions are pinned within their own Agent's list. Reordering one Agent's pinned Sessions leaves every other Agent's list as it was.
  it("scopes Session pins to their Agent", async () => {
    const pins = createSidebarPinsService({ repo: memoryRepo(), owner: "u1" });
    await pins.setSessions("a", ["s1", "s2"]);
    await pins.setSessions("b", ["s3"]);
    const after = await pins.setSessions("a", ["s2", "s1", "s2"]);
    expect(after.sessions).toEqual({ a: ["s2", "s1"], b: ["s3"] });
  });

  it("keeps each user's pins apart", async () => {
    const repo = memoryRepo();
    const mine = createSidebarPinsService({ repo, owner: "u1" });
    const theirs = createSidebarPinsService({ repo, owner: "u2" });
    await mine.setAgents(["a"]);
    await mine.setSessions("a", ["s1"]);
    expect(await theirs.get()).toEqual({ agents: [], sessions: {} });
  });
});
