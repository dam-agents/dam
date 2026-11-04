// TEST_OVERVIEW: A person whose assistant has never been used lands in its chat instead of Home, once per page load; Home stays Home for a route that asked for it, for a person with no assistant, and for an assistant that already has a session.
import { describe, expect, it } from "vitest";

import { landingAssistantId } from "../../modules/agents/lib/assistant-landing.js";

const ASSISTANT = "agent-00000000000000a1";

describe("landing in the assistant's chat", () => {
  // TEST_SCENARIO: on Home, an assistant with no sessions of its own is the chat that opens.
  it("opens the assistant's chat when it has no sessions", () => {
    expect(
      landingAssistantId({
        view: "home",
        assistantId: ASSISTANT,
        sessions: [],
      }),
    ).toBe(ASSISTANT);
  });

  // TEST_SCENARIO: an assistant that already has a session, no assistant at all, a list still loading and any other route all leave the route alone.
  it("stays where the route asked when there is nothing to land in", () => {
    const home = { view: "home", assistantId: ASSISTANT };
    expect(
      landingAssistantId({ ...home, sessions: [{ sessionId: "s1" }] }),
    ).toBeNull();
    expect(
      landingAssistantId({ ...home, assistantId: null, sessions: [] }),
    ).toBeNull();
    expect(landingAssistantId({ ...home, sessions: undefined })).toBeNull();
    expect(
      landingAssistantId({
        view: "chat",
        assistantId: ASSISTANT,
        sessions: [],
      }),
    ).toBeNull();
  });
});
