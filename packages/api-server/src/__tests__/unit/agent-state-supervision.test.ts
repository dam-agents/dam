// TEST_OVERVIEW: what an agent's state says when nothing is running it. Readiness is published by the node that had it, and stays published — so on an install of several nodes, where an agent is released as it goes to sleep and placed again when it wakes, the last thing a node said is not the same as what is true now. A caller that believes it dials an address that answers to nobody.
import { describe, expect, it } from "vitest";
import { computeAgentState } from "../../modules/agents/infrastructure/agent-mappers.js";
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";

const agent = (over: Partial<InfraAgent>): InfraAgent =>
  ({
    id: "agent-1",
    name: "a",
    assignedNode: "node-1",
    supervised: true,
    spec: { name: "a", image: "img" },
    sweepable: false,
    lifetimeMs: 0,
    ready: false,
    hibernated: false,
    stopRequested: false,
    overBudget: false,
    sandboxRestarts: 0,
    ...over,
  }) as InfraAgent;

describe("an agent's state when no node is running it", () => {
  it("is running while a node has it and says it is ready", () => {
    expect(computeAgentState(agent({ ready: true }))).toBe("running");
  });

  // TEST_SCENARIO: the agent has been released — it is between nodes, or its last node left the install. The readiness on the record is what some node said before letting go.
  it("is not running once no node has it, whatever readiness still says", () => {
    expect(
      computeAgentState(
        agent({ ready: true, assignedNode: null, supervised: false }),
      ),
    ).toBe("starting");
  });

  // TEST_SCENARIO: the agent is still assigned, and the node holding it has stopped answering. Every call to it fails, so reporting it as running only sends callers at it.
  it("is not running once its node has gone quiet", () => {
    expect(
      computeAgentState(
        agent({ ready: true, assignedNode: "node-gone", supervised: false }),
      ),
    ).toBe("starting");
  });

  it("still reports an error ahead of anything else", () => {
    expect(
      computeAgentState(
        agent({
          ready: true,
          assignedNode: null,
          supervised: false,
          error: "x",
        }),
      ),
    ).toBe("error");
  });

  it("still reports hibernation for an agent at rest", () => {
    expect(
      computeAgentState(
        agent({ hibernated: true, assignedNode: null, supervised: false }),
      ),
    ).toBe("hibernated");
  });
});
