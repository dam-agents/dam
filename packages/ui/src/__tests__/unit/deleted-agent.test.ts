import { AGENT_PERMISSIONS } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  agentFallback,
  departedAgents,
} from "../../modules/agents/lib/deleted-agent.js";

const OWNS = [...AGENT_PERMISSIONS];

/**
 * TEST_OVERVIEW: A tab open on an agent learns that it is gone only when its
 * agent list drops the agent: another tab deleted it, or, for an Agent Editor,
 * the owner took them off the Editor List. That drop is remembered with what
 * to tell the person, and an unreadable agent that left this way sends them
 * home with that notice, rather than waiting on it or bouncing to its public
 * page.
 */

const own = (id: string) => ({
  id,
  name: id,
  access: { role: "owner" as const, editors: [], permissions: OWNS },
});
const shared = (id: string) => ({
  id,
  name: id,
  access: {
    role: "editor" as const,
    ownerEmail: null,
    editors: [],
    permissions: [],
  },
});

describe("departed agent", () => {
  // TEST_SCENARIO: an agent missing from the refreshed list is reported; the first load and kept agents are not.
  it("reports the agents that left the list", () => {
    expect(departedAgents([own("a"), own("b")], [own("b")])).toEqual([
      { id: "a", notice: "This agent was deleted." },
    ]);
    expect(departedAgents(undefined, [own("a")])).toEqual([]);
    expect(departedAgents([own("a")], [own("a"), own("b")])).toEqual([]);
  });

  // TEST_SCENARIO: an Agent Editor cannot tell a deleted agent from one they were taken off, and must not be told it was deleted; they are told by name that they lost access.
  it("tells an editor they lost access to a shared agent", () => {
    expect(departedAgents([shared("Release helper")], [])).toEqual([
      {
        id: "Release helper",
        notice: "You no longer have access to Release helper.",
      },
    ]);
  });

  // TEST_SCENARIO: an unreadable agent goes to its public page unless it is known to have left, which goes home.
  it("sends an unreadable departed agent home", () => {
    expect(agentFallback(true, true)).toBe("home");
    expect(agentFallback(true, false)).toBe("public");
    expect(agentFallback(false, true)).toBeNull();
  });
});
