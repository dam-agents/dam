// TEST_OVERVIEW: a raw error is worth asking the assistant about, so each surface hands it a message that names the agent and the session, schedule or outage, says when it happened in ISO time, quotes the failure's first line folded to one line and cut at 200 characters, and asks what happened and what to do. Nothing is sent: the text waits in the assistant's composer until the person sends it. The link itself is offered only to the agent's owner, only when the assistant is on and its record is ready, and never for the assistant's own chat.
import { describe, expect, it } from "vitest";

import {
  ASK_ERROR_MAX,
  askAboutCrash,
  askAboutSchedule,
  askAboutTurn,
  askAboutUnavailable,
  askErrorLine,
  canAskAssistant,
} from "../../modules/assistants/lib/ask-prefill.js";

const AT = "2026-11-18T09:30:00.000Z";
const ASK = "Please explain what happened and what I can do.";

describe("the message an error leaves for the assistant", () => {
  // TEST_SCENARIO: a reply whose turn ended in an error. The person asks about that turn, so the message must name the agent, the session and the time, and quote the error.
  it("names the agent, the session, the time and the error", () => {
    expect(
      askAboutTurn({
        agentName: "Scout",
        sessionId: "s-1",
        at: AT,
        error: "Model provider refused the request\nsecond line",
      }),
    ).toBe(
      `Scout's turn in session s-1 ended in an error at ${AT}: Model provider refused the request. ${ASK}`,
    );
  });

  // TEST_SCENARIO: a crash notice says the agent restarted. Asking about it must carry what the notice said, not just the agent's name.
  it("names the agent, the time and the notice on a crash", () => {
    expect(
      askAboutCrash({
        agentName: "Scout",
        at: AT,
        notice:
          "Scout ran out of memory and restarted — ask an operator to raise its memory budget",
      }),
    ).toBe(
      `Scout crashed at ${AT}: Scout ran out of memory and restarted — ask an operator to raise its memory budget. ${ASK}`,
    );
  });

  // TEST_SCENARIO: the overlay explains why an agent is not running. The question must carry that explanation, since the person sees it and nothing else.
  it("names the agent, the time and the overlay's description", () => {
    expect(
      askAboutUnavailable({
        agentName: "Scout",
        at: AT,
        description: "The agent hit an error and isn't running.",
      }),
    ).toBe(
      `Scout is unavailable at ${AT}: The agent hit an error and isn't running. ${ASK}`,
    );
  });

  // TEST_SCENARIO: a schedule card shows a failed or missed result. The question must name the schedule as well as the agent, since one agent runs many.
  it("names the schedule, the agent, the time and the result", () => {
    expect(
      askAboutSchedule({
        agentName: "Scout",
        scheduleName: "Nightly audit",
        at: AT,
        result: "Failed: the precheck script exited 2",
      }),
    ).toBe(
      `The schedule "Nightly audit" on Scout last fired at ${AT} with the result: Failed: the precheck script exited 2. ${ASK}`,
    );
  });
});

describe("the failure's first line", () => {
  // TEST_SCENARIO: a runtime answers with control characters in its first line and more lines under it. The composer must get one clean line, so what is left of the escapes folds to single spaces and the later lines are left out.
  it("folds control characters and runs of whitespace into single spaces", () => {
    expect(askErrorLine("boom\u0000 \tat foo   baz\r\nsecond line")).toBe(
      "boom at foo baz",
    );
  });

  // TEST_SCENARIO: a stack trace is longer than anyone would paste. The line is cut at the cap, marked with an ellipsis, so the message stays short and the person can still send it.
  it("cuts a long line at the cap and marks the cut", () => {
    const line = askErrorLine("x".repeat(ASK_ERROR_MAX * 2));
    expect(line).toHaveLength(ASK_ERROR_MAX);
    expect(line.endsWith("…")).toBe(true);
    expect(line).not.toMatch(/\n/);
  });

  // TEST_SCENARIO: a failure usually ends in a period, and the message carries the line as the end of a sentence. The punctuation must not double.
  it("drops the closing punctuation the message supplies", () => {
    expect(askErrorLine("the provider timed out.")).toBe(
      "the provider timed out",
    );
  });
});

describe("whether the link is offered", () => {
  const ok = {
    assistantOn: true,
    assistantKnown: true,
    assistantId: "assistant-1",
    agentId: "agent-1",
    isOwner: true,
  };

  // TEST_SCENARIO: the ordinary case the whole feature is for: the person owns the agent that failed and they have an assistant to ask.
  it("is offered to the owner of an agent that is not the assistant", () => {
    expect(canAskAssistant(ok)).toBe(true);
  });

  // TEST_SCENARIO: the tabs have not learned yet whether the person has an assistant, or which Agent it is. Nothing may be offered on a guess.
  it("is withheld while the assistant's record is not settled", () => {
    expect(canAskAssistant({ ...ok, assistantKnown: false })).toBe(false);
  });

  // TEST_SCENARIO: the install or the person has the assistant off. It may not be asked.
  it("is withheld for a person the feature is off for", () => {
    expect(canAskAssistant({ ...ok, assistantOn: false })).toBe(false);
  });

  // TEST_SCENARIO: the feature is on but no Agent is recorded as the assistant, so there is no chat to open.
  it("is withheld with no assistant's Agent", () => {
    expect(canAskAssistant({ ...ok, assistantId: null })).toBe(false);
    expect(canAskAssistant({ ...ok, assistantId: undefined })).toBe(false);
  });

  // TEST_SCENARIO: a surface that has no agent to blame, such as the combined out-of-memory notice, has nothing to ask about.
  it("is withheld with no agent", () => {
    expect(canAskAssistant({ ...ok, agentId: null })).toBe(false);
    expect(canAskAssistant({ ...ok, agentId: undefined })).toBe(false);
  });

  // TEST_SCENARIO: the assistant's own chat shows errors too. It cannot ask itself.
  it("is withheld in the assistant's own chat", () => {
    expect(canAskAssistant({ ...ok, agentId: ok.assistantId })).toBe(false);
  });

  // TEST_SCENARIO: an editor sees another person's agent. The assistant is the person's own, so an editor has none to ask about it.
  it("is withheld from an agent's editor", () => {
    expect(canAskAssistant({ ...ok, isOwner: false })).toBe(false);
  });
});
