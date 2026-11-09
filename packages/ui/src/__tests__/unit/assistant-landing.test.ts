// TEST_OVERVIEW: A person whose assistant has never been used lands in its chat
// TEST_OVERVIEW: instead of Home, once per page load: the decision waits for the
// TEST_OVERVIEW: feature's own answer, the agent list and the record, so whichever
// TEST_OVERVIEW: arrives last decides and nothing is spent on a guess. Home stays
// TEST_OVERVIEW: Home for a route that asked for it, for a person with no assistant,
// TEST_OVERVIEW: for one whose Agent they deleted, and for an assistant that has
// TEST_OVERVIEW: been used. Resetting a person's onboarding releases the one-shot,
// TEST_OVERVIEW: so the next evaluation routes them as a first-timer is routed.
import { describe, expect, it } from "vitest";

import { landingAssistantId } from "../../modules/agents/lib/assistant-landing.js";

const ASSISTANT = "agent-00000000000000a1";
const LOADED = {
  view: "home",
  gateKnown: true,
  listLoaded: true,
  stateLoaded: true,
};
const UNUSED = { assistantId: ASSISTANT, used: false };

describe("landing in the assistant's chat", () => {
  // TEST_SCENARIO: on Home, once every answer is in and the assistant is unused, its chat opens — including while it is asleep.
  it("opens the assistant's chat when the server says it is unused", () => {
    expect(landingAssistantId({ ...LOADED, ...UNUSED })).toEqual({
      decide: true,
      landIn: ASSISTANT,
    });
  });

  // TEST_SCENARIO: the agent list arrives first, with the assistant's record still unknown: nothing is decided and the one-shot is not spent.
  it("waits for the record when the list came first", () => {
    expect(
      landingAssistantId({
        ...LOADED,
        stateLoaded: false,
        assistantId: null,
        used: undefined,
      }),
    ).toEqual({ decide: false });
  });

  // TEST_SCENARIO: the record arrives before the feature's own answer — the flags query resolving after the state query — so nothing is decided until the flag is in, and then it lands.
  it("waits for the feature's answer when the record came first", () => {
    expect(
      landingAssistantId({ ...LOADED, gateKnown: false, ...UNUSED }),
    ).toEqual({ decide: false });
    expect(
      landingAssistantId({ ...LOADED, listLoaded: false, ...UNUSED }),
    ).toEqual({ decide: false });
    expect(landingAssistantId({ ...LOADED, ...UNUSED })).toEqual({
      decide: true,
      landIn: ASSISTANT,
    });
  });

  // TEST_SCENARIO: a used assistant, a record whose Agent is not in the list — the person deleted it — nobody's assistant and any other route all leave the route alone.
  it("stays where the route asked when there is nothing to land in", () => {
    for (const input of [
      { assistantId: ASSISTANT, used: true },
      { assistantId: null, used: false },
      { assistantId: ASSISTANT, used: undefined },
    ])
      expect(landingAssistantId({ ...LOADED, ...input })).toEqual({
        decide: true,
        landIn: null,
      });
    expect(landingAssistantId({ ...LOADED, view: "chat", ...UNUSED })).toEqual({
      decide: true,
      landIn: null,
    });
  });
});
