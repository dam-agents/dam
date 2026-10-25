import { describe, expect, it } from "vitest";
import { composeLiveEventsModule } from "../../modules/live-events/compose.js";

// TEST_OVERVIEW: after the switch the browser hint for an Agent comes from the
// TEST_OVERVIEW: row feed, not from a watch on the frozen custom resources. The
// TEST_OVERVIEW: module's agentChanged is that path: it publishes the same
// TEST_OVERVIEW: `agents` hint and runs the same in-process reactions.

describe("agent hints without the custom-resource watch", () => {
  // TEST_SCENARIO: The cache's feed handler calls agentChanged; a browser waiting on the agent's owner must receive one `agents` hint and the session watcher and alert evaluator must hear about it.
  it("publishes the hint and runs the in-process reactions", () => {
    const published: Array<{ owner: string; event: unknown }> = [];
    const changed: string[] = [];
    const module = composeLiveEventsModule({
      bus: {
        publish: async (owner, event) => {
          published.push({ owner, event });
        },
        subscribe: () => () => {},
        close: async () => {},
      },
      log: () => {},
      k8s: { watchCustomObjects: () => () => {} },
      onAgentChanged: (agentId) => void changed.push(agentId),
      editorsOf: async () => [],
    });
    module.agentChanged("agent-1", "owner-1");
    expect(published).toHaveLength(1);
    expect(published[0]?.owner).toBe("events:owner:owner-1");
    expect(JSON.parse(String(published[0]?.event))).toEqual({
      topic: "agents",
      agentId: "agent-1",
    });
    expect(changed).toEqual(["agent-1"]);
  });
});
