// TEST_OVERVIEW: what an owner reads and sets about an agent's web search. The state is whether control is on and the agent's one web search rule, with who set it. Setting the rule to allow or deny replaces it, clearing it makes every search ask again, and none of it reaches an agent its caller does not own.
import { describe, expect, it } from "vitest";
import type { WebSearchRepository } from "../../modules/web-search/infrastructure/web-search-repository.js";
import { createWebSearchService } from "../../modules/web-search/services/web-search-service.js";
import type { WebSearchRuleRow } from "../../modules/web-search/domain/types.js";

function makeService(owned = true) {
  const rules = new Map<string, WebSearchRuleRow>();
  const repo: WebSearchRepository = {
    controlOf: async (agentId) => agentId === "agent-1",
    ruleOf: async (agentId) => rules.get(agentId) ?? null,
    writeRule: async ({ agentId, verdict, decidedBy }) => {
      const row = { agentId, verdict, decidedBy, decidedAt: new Date(0) };
      rules.set(agentId, row);
      return row;
    },
    clearRule: async (agentId) => void rules.delete(agentId),
    listAgentIds: async () => [...rules.keys()],
  };
  return createWebSearchService({
    repo,
    isAgentOwnedBy: async () => owned,
    ownerSub: "owner-1",
    actor: "editor-1",
    resolveUserEmail: async (sub) => `${sub}@example.com`,
  });
}

describe("an agent's web search state", () => {
  // TEST_SCENARIO: a new rule is the owner's answer to every later search, shown with who set it; clearing it brings back the question.
  it("sets, replaces and clears the rule", async () => {
    const service = makeService();
    expect(await service.state("agent-1")).toEqual({
      control: true,
      rule: null,
    });

    expect(await service.setRule("agent-1", "allow")).toEqual({
      control: true,
      rule: {
        verdict: "allow",
        decidedBy: "editor-1",
        decidedByEmail: "editor-1@example.com",
        decidedAt: new Date(0).toISOString(),
      },
    });
    expect((await service.setRule("agent-1", "deny")).rule?.verdict).toBe(
      "deny",
    );
    expect((await service.setRule("agent-1", null)).rule).toBeNull();
  });

  // TEST_SCENARIO: an agent the caller does not own reads as not found and keeps its rule.
  it("refuses an agent its caller does not own", async () => {
    const service = makeService(false);
    await expect(service.state("agent-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.setRule("agent-1", "allow")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
