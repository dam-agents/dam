// TEST_OVERVIEW: the Agent Sweep deletes a sweepable Agent once it has slept past its lifetime, a throwaway one as soon as it sleeps. It deletes through the owner's Agents service, which scopes the delete to the owner's Agent, but as itself: the security log row of the delete names the sweep as a system actor, never the owner as a person.
import { describe, expect, test, vi } from "vitest";

const securityLog = vi.fn();
vi.mock("../../core/security-log.js", () => ({ securityLog }));

const { AGENT_SWEEP_ACTOR, createAgentSweep } =
  await import("../../modules/agents/services/agent-sweep.js");
const { createAgentsService } =
  await import("../../modules/agents/services/agents-service.js");
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

function agent(id: string, fields: Partial<InfraAgent>): InfraAgent {
  return {
    id,
    owner: "owner-1",
    sweepable: true,
    lifetimeMs: 0,
    hibernated: false,
    ...fields,
  } as InfraAgent;
}

function agentsServiceFor(
  owner: string,
  as: { actor: string; actorKind: "user" | "system" },
  deleted: string[],
) {
  return createAgentsService({
    owner,
    ...as,
    repo: {
      delete: async (id: string) => {
        deleted.push(id);
        return true;
      },
    } as unknown as AgentsDeps["repo"],
    cleanupHooks: [],
  } as unknown as AgentsDeps);
}

describe("the Agent Sweep", () => {
  // TEST_SCENARIO: a throwaway target that went to sleep is deleted on the next tick; one still awake, which is what a target waiting for its run to start is kept, is left for its run.
  test("deletes a sleeping throwaway Agent and leaves an awake one", async () => {
    const deleted: string[] = [];
    const sweep = createAgentSweep({
      listAgents: async () => [
        agent("asleep", { hibernated: true }),
        agent("awake", { hibernated: false }),
        agent("not-sweepable", { hibernated: true, sweepable: false }),
      ],
      agentsFor: (owner, as) => agentsServiceFor(owner, as, deleted),
    });

    await sweep.tick();

    expect(deleted).toEqual(["asleep"]);
  });

  // TEST_SCENARIO: the delete is the platform's, so its security log row says the sweep made it and that the actor is a system, not the owner's sub as a user.
  test("logs its delete as the sweep, not as the owner", async () => {
    securityLog.mockClear();
    const sweep = createAgentSweep({
      listAgents: async () => [agent("asleep", { hibernated: true })],
      agentsFor: (owner, as) => agentsServiceFor(owner, as, []),
    });

    await sweep.tick();

    const rows = securityLog.mock.calls.filter(
      ([, event]) => event === "agent.delete",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]![2]).toMatchObject({
      actor: AGENT_SWEEP_ACTOR.actor,
      actorKind: "system",
      agentId: "asleep",
    });
  });

  // TEST_SCENARIO: a person's delete through the same service still reads as theirs.
  test("a delete by the owner still logs the owner as a user", async () => {
    securityLog.mockClear();
    const agents = createAgentsService({
      owner: "owner-1",
      actor: "owner-1",
      repo: {
        delete: async () => true,
      } as unknown as AgentsDeps["repo"],
      cleanupHooks: [],
    } as unknown as AgentsDeps);

    await agents.delete("agent-1");

    const rows = securityLog.mock.calls.filter(
      ([, event]) => event === "agent.delete",
    );
    expect(rows[0]![2]).toMatchObject({
      actor: "owner-1",
      actorKind: "user",
    });
  });
});
