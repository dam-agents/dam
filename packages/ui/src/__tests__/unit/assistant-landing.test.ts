// TEST_OVERVIEW: A person whose assistant has never been used lands in its chat instead of Home, once per page load; Home stays Home for a route that asked for it, for a person with no assistant, and for an assistant that has been used — the server says which, so a sleeping assistant is decided without waking it.
import { describe, expect, it } from "vitest";

import { landingAssistantId } from "../../modules/agents/lib/assistant-landing.js";

const ASSISTANT = "agent-00000000000000a1";
const HOME = { view: "home", assistantId: ASSISTANT };

describe("landing in the assistant's chat", () => {
  // TEST_SCENARIO: on Home, an assistant the server reports as unused opens its chat — including while it is asleep.
  it("opens the assistant's chat when the server says it is unused", () => {
    expect(landingAssistantId({ ...HOME, used: false })).toBe(ASSISTANT);
  });

  // TEST_SCENARIO: a used assistant, nobody's assistant, an answer still on its way and any other route all leave the route alone.
  it("stays where the route asked when there is nothing to land in", () => {
    expect(landingAssistantId({ ...HOME, used: true })).toBeNull();
    expect(
      landingAssistantId({ ...HOME, assistantId: null, used: false }),
    ).toBeNull();
    expect(landingAssistantId({ ...HOME, used: undefined })).toBeNull();
    expect(
      landingAssistantId({ view: "chat", assistantId: ASSISTANT, used: false }),
    ).toBeNull();
  });
});
