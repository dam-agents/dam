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
  assistantOn: true,
  listLoaded: true,
  stateLoaded: true,
};
const UNUSED = {
  recordReady: true,
  assistantId: ASSISTANT,
  used: false,
  ownsOtherAgents: false,
  afterReset: false,
};

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
        recordReady: false,
        assistantId: null,
        used: undefined,
        ownsOtherAgents: false,
        afterReset: false,
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

  // TEST_SCENARIO: the platform makes the assistant behind the request, so the record arrives empty and then `creating` while the Agent is still being made: nothing is decided and the one-shot is kept, and the landing happens once the record turns ready and the agent list carries it — a person never dropped on Home by a create that was still running.
  it("keeps the one-shot while the platform is still making the assistant", () => {
    expect(
      landingAssistantId({
        ...LOADED,
        recordReady: false,
        assistantId: null,
        used: false,
        ownsOtherAgents: false,
        afterReset: false,
      }),
    ).toEqual({ decide: false });
    expect(
      landingAssistantId({
        ...LOADED,
        recordReady: false,
        assistantId: null,
        used: undefined,
        ownsOtherAgents: false,
        afterReset: false,
      }),
    ).toEqual({ decide: false });
    expect(landingAssistantId({ ...LOADED, ...UNUSED })).toEqual({
      decide: true,
      landIn: ASSISTANT,
    });
  });

  // TEST_SCENARIO: a used assistant, a record whose Agent is not in the list — the person deleted it — nobody's assistant, the feature off for them and any other route all leave the route alone.
  it("stays where the route asked when there is nothing to land in", () => {
    for (const input of [
      { ...UNUSED, used: true },
      { ...UNUSED, assistantId: null },
      { ...UNUSED, used: undefined },
      { ...UNUSED, assistantOn: false, assistantId: null },
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

  // TEST_SCENARIO: the assistant's chat is the first open, not a redirect for an account that has Agents of its own: an existing owner gets the assistant in the list and keeps their landing, while a person whose only Agent is the assistant lands in it.
  it("lands only a person who owns nothing else", () => {
    expect(landingAssistantId({ ...LOADED, ...UNUSED })).toEqual({
      decide: true,
      landIn: ASSISTANT,
    });
    expect(
      landingAssistantId({ ...LOADED, ...UNUSED, ownsOtherAgents: true }),
    ).toEqual({ decide: true, landIn: null });
  });

  // TEST_SCENARIO: the onboarding reset is the one ask that lands a person in the assistant's chat whatever else they own, since it is the reset that promised a first open.
  it("lands them after the reset, whatever else they own", () => {
    expect(
      landingAssistantId({
        ...LOADED,
        ...UNUSED,
        ownsOtherAgents: true,
        afterReset: true,
      }),
    ).toEqual({ decide: true, landIn: ASSISTANT });
  });
});
