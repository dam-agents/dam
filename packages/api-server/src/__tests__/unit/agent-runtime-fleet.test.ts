// TEST_OVERVIEW: the runtime fleet count reads which agents still run an image older than their template's, scoped to what the caller may see.
import { describe, expect, it } from "vitest";

import { createAgentsService } from "../../modules/agents/services/agents-service.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

const agent = (id: string, image: string) => ({
  id,
  name: id,
  templateId: "default",
  spec: { image },
});

describe("runtimeFleet", () => {
  const agents = createAgentsService({
    owner: "owner-1",
    repo: {
      list: async () => [
        agent("a1", "platform/default:2"),
        agent("a2", "platform/default:2"),
        agent("a3", "platform/default:1"),
      ],
    },
    readTemplateSpec: async () => ({
      spec: { image: "platform/default:2" },
    }),
  } as unknown as AgentsDeps);

  /** TEST_SCENARIO: An API key bound to some agents sees the fleet of those
   * agents only, in both the outdated list and the count of agents on the
   * current image; an unbound caller sees every agent of the owner. */
  it("counts only the agents a bound key may see", async () => {
    const all = await agents.runtimeFleet();
    expect(all.onCurrent).toBe(2);
    expect(all.outdated.map((a) => a.agentId)).toEqual(["a3"]);

    const bound = await agents.runtimeFleet(["a1", "a3"]);
    expect(bound.onCurrent).toBe(1);
    expect(bound.outdated.map((a) => a.agentId)).toEqual(["a3"]);
  });
});
