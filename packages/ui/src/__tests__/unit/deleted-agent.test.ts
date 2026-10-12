import { describe, expect, it } from "vitest";

import {
  agentFallback,
  vanishedAgentIds,
} from "../../modules/agents/lib/deleted-agent.js";

/**
 * TEST_OVERVIEW: A tab open on an agent that another tab deletes learns of it
 * only when its agent list drops the agent. That drop marks the agent deleted,
 * and an unreadable deleted agent sends the visitor home rather than waiting on
 * it or bouncing to its public page.
 */

describe("deleted agent", () => {
  // TEST_SCENARIO: an agent missing from the refreshed list is reported; the first load and kept agents are not.
  it("reports the agents that left the list", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    expect(vanishedAgentIds([a, b], [b])).toEqual(["a"]);
    expect(vanishedAgentIds(undefined, [a])).toEqual([]);
    expect(vanishedAgentIds([a], [a, b])).toEqual([]);
  });

  // TEST_SCENARIO: an unreadable agent goes to its public page unless it is known deleted, which goes home.
  it("sends an unreadable deleted agent home", () => {
    expect(agentFallback(true, true)).toBe("home");
    expect(agentFallback(true, false)).toBe("public");
    expect(agentFallback(false, true)).toBeNull();
  });
});
