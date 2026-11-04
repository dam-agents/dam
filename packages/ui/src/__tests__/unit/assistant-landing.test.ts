// TEST_OVERVIEW: A person whose assistant has never been used lands in its chat instead of Home, once per page load: the decision waits for both the agent list and the assistant's own record, so whichever arrives first cannot spend the one-shot. Home stays Home for a route that asked for it, for a person with no assistant, and for an assistant that has been used — the server says which, so a sleeping assistant is decided without waking it.
import { describe, expect, it } from "vitest";

import { landingAssistantId } from "../../modules/agents/lib/assistant-landing.js";

const ASSISTANT = "agent-00000000000000a1";
const LOADED = { view: "home", listLoaded: true, stateLoaded: true };

describe("landing in the assistant's chat", () => {
  // TEST_SCENARIO: on Home, once both answers are in and the assistant is unused, its chat opens — including while it is asleep.
  it("opens the assistant's chat when the server says it is unused", () => {
    expect(
      landingAssistantId({
        ...LOADED,
        assistantId: ASSISTANT,
        used: false,
      }),
    ).toEqual({ decide: true, landIn: ASSISTANT });
  });

  // TEST_SCENARIO: the agent list arrives first, with the assistant still unknown: nothing is decided and the one-shot is not spent.
  it("waits for the assistant's record when the list came first", () => {
    expect(
      landingAssistantId({
        view: "home",
        listLoaded: true,
        stateLoaded: false,
        assistantId: null,
        used: undefined,
      }),
    ).toEqual({ decide: false });
  });

  // TEST_SCENARIO: the assistant's record arrives first, with the list still loading: it still waits, and lands once the list names the assistant.
  it("waits for the list when the record came first", () => {
    expect(
      landingAssistantId({
        view: "home",
        listLoaded: false,
        stateLoaded: true,
        assistantId: ASSISTANT,
        used: false,
      }),
    ).toEqual({ decide: false });
    expect(
      landingAssistantId({
        ...LOADED,
        assistantId: ASSISTANT,
        used: false,
      }),
    ).toEqual({ decide: true, landIn: ASSISTANT });
  });

  // TEST_SCENARIO: a used assistant, a row whose Agent is not in the list yet, nobody's assistant and any other route all leave the route alone.
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
    expect(
      landingAssistantId({
        ...LOADED,
        view: "chat",
        assistantId: ASSISTANT,
        used: false,
      }),
    ).toEqual({ decide: true, landIn: null });
  });
});
