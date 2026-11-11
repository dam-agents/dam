// TEST_OVERVIEW: web search control as an Agent setting. It is off on a new agent, the owner turns it on and off in the agent's settings, and it reaches the controller on the Agent's spec, which renders the gateway from it. A child that an agent with control launches, a sub-agent or an Environment, has a gateway of its own, so it carries the control too.
import { describe, expect, it } from "vitest";
import { stubAgentsService } from "../helpers/agents-service-stub.js";

const create = { name: "test-agent", image: "example.com/agent:latest" };

describe("an agent's web search control", () => {
  // TEST_SCENARIO: a new agent has control off, with no field on its spec, so its gateway reads no body.
  it("is off on a new agent", async () => {
    const { agents, persist } = stubAgentsService();
    await agents.create(create);
    expect(persist.mock.calls[0]![0]).not.toHaveProperty("webSearchControl");
  });

  // TEST_SCENARIO: the settings switch sets the field to turn control on and removes it to turn control off, so an agent switched off looks like one that never had it.
  it.each([
    [true, true],
    [false, null],
  ])("is set from settings: %s patches %s", async (value, patched) => {
    const { agents, patchSpec } = stubAgentsService();
    await agents.update({ id: "agent-1", webSearchControl: value });
    expect(patchSpec.mock.calls[0]![2]).toEqual({ webSearchControl: patched });
  });

  // TEST_SCENARIO: a child of an agent with control on is created with control on; a child of an agent without it is not.
  it.each([
    [true, true],
    [false, false],
  ])(
    "a child of a launcher with control %s has it %s",
    async (launcher, child) => {
      const { agents, persist } = stubAgentsService((id) =>
        id === "parent-1" && launcher ? { webSearchControl: true } : {},
      );
      await agents.create({
        ...create,
        linkFrom: "parent-1",
        inheritance: {
          parentAgentId: "parent-1",
          connectionsFrom: "none",
          egressFrom: "parent",
        },
      });
      expect(persist.mock.calls[0]![0].webSearchControl === true).toBe(child);
    },
  );
});
