// TEST_OVERVIEW: Whose rules an egress request falls under. An ordinary agent decides by its own; an Environment by its Owning Agent's, of the same owner, and the approval names the Environment. An Environment whose Owning Agent is gone or belongs to someone else resolves to nothing, so the gate denies it.
import { describe, expect, it } from "vitest";
import {
  createEgressIdentityResolver,
  type AgentIdentity,
} from "../../modules/environments/services/egress-identity.js";

function resolver(agents: AgentIdentity[], names: Record<string, string> = {}) {
  return createEgressIdentityResolver({
    resolveRoot: async (id) => id,
    identityOf: async (id) => agents.find((a) => a.agentId === id) ?? null,
    environmentName: async (id) => names[id] ?? null,
  });
}

describe("the egress identity", () => {
  // TEST_SCENARIO: an ordinary agent is its own identity; an Environment is its Owning Agent's, naming the Environment, or its id when the row is gone.
  it("resolves an Environment to its Owning Agent", async () => {
    const r = resolver(
      [
        { owner: "alice", agentId: "agent-owning" },
        { owner: "alice", agentId: "agent-env", environmentOf: "agent-owning" },
        {
          owner: "alice",
          agentId: "agent-gone-row",
          environmentOf: "agent-owning",
        },
      ],
      { "agent-env": "pr-42" },
    );

    expect(await r.resolve("agent-owning")).toEqual({
      ownerSub: "alice",
      agentId: "agent-owning",
    });
    expect(await r.resolve("agent-env")).toEqual({
      ownerSub: "alice",
      agentId: "agent-owning",
      environment: "pr-42",
    });
    expect((await r.resolve("agent-gone-row"))?.environment).toBe(
      "agent-gone-row",
    );
  });

  // TEST_SCENARIO: an Environment whose Owning Agent is gone, or is someone else's, resolves to nothing.
  it("resolves nothing across owners or without the Owning Agent", async () => {
    const r = resolver([
      { owner: "bob", agentId: "agent-bobs" },
      { owner: "alice", agentId: "agent-env", environmentOf: "agent-bobs" },
      { owner: "alice", agentId: "agent-orphan", environmentOf: "agent-none" },
    ]);

    expect(await r.resolve("agent-env")).toBeNull();
    expect(await r.resolve("agent-orphan")).toBeNull();
    expect(await r.resolve("agent-unknown")).toBeNull();
  });
});
