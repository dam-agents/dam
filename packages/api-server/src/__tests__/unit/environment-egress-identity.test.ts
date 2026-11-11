// TEST_OVERVIEW: Whose rules an egress request falls under. An ordinary agent decides by its own; an Environment by its Owning Agent's, of the same owner, and the approval names the Environment; a child whose egress is its own by its own. An Environment whose Owning Agent is gone or belongs to someone else resolves to nothing, so the gate denies it.
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

  // TEST_SCENARIO: a child whose egress is its own, or whose nearest such ancestor is, falls under that child, not its root: an Environment no longer hops to its Owning Agent, and the result says how the child's rules widen and which parent shows its prompts.
  it("stops at the nearest child with egress of its own", async () => {
    const r = createEgressIdentityResolver({
      resolveRoot: async () => "agent-root",
      identityOf: async (id) =>
        ({
          "agent-root": { owner: "alice", agentId: "agent-root" },
          "agent-env": {
            owner: "alice",
            agentId: "agent-env",
            environmentOf: "agent-root",
          },
        })[id] ?? null,
      environmentName: async () => "pr-42",
      nearestOwnEgress: async (id) =>
        id === "agent-env" || id === "agent-env-child"
          ? {
              agentId: "agent-env",
              mode: "scoped",
              parentAgentId: "agent-root",
            }
          : null,
    });
    const own = {
      ownerSub: "alice",
      agentId: "agent-env",
      environment: "pr-42",
      own: { mode: "scoped", parentAgentId: "agent-root" },
    };
    expect(await r.resolve("agent-env")).toEqual(own);
    expect(await r.resolve("agent-env-child")).toEqual(own);
    expect(await r.resolve("agent-root")).toEqual({
      ownerSub: "alice",
      agentId: "agent-root",
    });
  });
});
