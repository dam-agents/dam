// TEST_OVERVIEW: an agent's gateway injects a Connection's credential only into requests that name that Connection, unless the agent declines it. A new agent requires it unless its create, or the starter kit behind it, says no; its settings change it later. The choice travels to the controller on the Agent's spec, and an agent that declines keeps no trace of the field, so its gateway renders as an unaddressed one.
import { describe, expect, it } from "vitest";
import { stubAgentsService as setup } from "../helpers/agents-service-stub.js";

const create = { name: "test-agent", image: "example.com/agent:latest" };

describe("an agent's connection addressing", () => {
  // TEST_SCENARIO: a new agent requires named connections whether its create asks for it or says nothing, and carries the field on its spec, which is all the controller reads.
  it.each([undefined, true])(
    "reaches the spec when the create says %s",
    async (value) => {
      const { agents, persist } = setup();
      await agents.create({ ...create, requireConnectionAddress: value });
      expect(persist.mock.calls[0]![0]).toMatchObject({
        requireConnectionAddress: true,
      });
    },
  );

  // TEST_SCENARIO: an agent whose create explicitly declines has no field at all, so its gateway injects every request to a Connection's host.
  it("is absent from the spec when the create declines it", async () => {
    const { agents, persist } = setup();
    await agents.create({ ...create, requireConnectionAddress: false });
    expect(persist.mock.calls[0]![0]).not.toHaveProperty(
      "requireConnectionAddress",
    );
  });

  // TEST_SCENARIO: the settings switch turns the mode on for an existing agent by setting the field, and off by removing it, so an agent switched off looks like one that never asked.
  it.each([
    [true, true],
    [false, null],
  ])("is set from settings: %s patches %s", async (value, patched) => {
    const { agents, patchSpec } = setup();
    await agents.update({ id: "agent-1", requireConnectionAddress: value });
    expect(patchSpec.mock.calls[0]![2]).toEqual({
      requireConnectionAddress: patched,
    });
  });

  // TEST_SCENARIO: a settings save that does not touch the switch leaves the field alone.
  it("is untouched by an update that does not name it", async () => {
    const { agents, patchSpec } = setup();
    await agents.update({ id: "agent-1", name: "renamed" });
    expect(patchSpec.mock.calls[0]![2]).not.toHaveProperty(
      "requireConnectionAddress",
    );
  });
});
