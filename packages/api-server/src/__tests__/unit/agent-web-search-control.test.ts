// TEST_OVERVIEW: web search control as an Agent setting. It is off on a new agent, the owner turns it on and off in the agent's settings, and it reaches the controller on the Agent's spec, which renders the gateway from it. A child that an agent with control launches, a sub-agent or an Environment, has a gateway of its own, so it carries the control too. The agent's machine learns of the setting from the PLATFORM_WEB_SEARCH_CONTROL env var, so a harness there stops asking about a search the gateway already asks about.
import { describe, expect, it } from "vitest";
import {
  createBuiltinContributions,
  WEB_SEARCH_CONTROL_ENV,
} from "../../modules/runtime-delivery/services/builtin-contributions.js";
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

  // TEST_SCENARIO: an agent with control on gets PLATFORM_WEB_SEARCH_CONTROL=1 in the env of every harness, and an agent with control off gets no such variable, so its harness asks about a search as before.
  it.each([
    [
      true,
      [{ kind: "env", name: "PLATFORM_WEB_SEARCH_CONTROL", placeholder: "1" }],
    ],
    [false, []],
  ])("with control %s the machine's env carries %j", (control, env) => {
    const builtin = createBuiltinContributions({
      harnessServerUrl: "http://harness:4001",
      telemetryEnv: () => [],
    });
    expect(
      builtin
        .for("agent-1", {
          agentName: null,
          webSearchControl: control,
          sharedKnowledgeBases: false,
          harnesses: [],
        })
        .filter((c) => c.kind === "env"),
    ).toEqual(env);
    expect(WEB_SEARCH_CONTROL_ENV).toBe("PLATFORM_WEB_SEARCH_CONTROL");
  });

  // TEST_SCENARIO: the switch changes what the state builder reads, so each turn of it pushes the agent's runtime state, and a running harness restarts on the new env without a pod roll.
  it.each([true, false])(
    "pushes the runtime state when control turns %s",
    async (value) => {
      const { agents, pushRuntimeState } = stubAgentsService();
      await agents.update({ id: "agent-1", webSearchControl: value });
      expect(pushRuntimeState).toHaveBeenCalledWith("agent-1");
    },
  );

  // TEST_SCENARIO: a save that does not touch the switch pushes nothing for it.
  it("pushes nothing when a save leaves control alone", async () => {
    const { agents, pushRuntimeState } = stubAgentsService();
    await agents.update({ id: "agent-1", description: "d" });
    expect(pushRuntimeState).not.toHaveBeenCalled();
  });
});
