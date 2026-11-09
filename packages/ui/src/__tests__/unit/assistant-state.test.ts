// @vitest-environment happy-dom
// TEST_OVERVIEW: the assistant's state as the client keeps it: whether the person
// TEST_OVERVIEW: has an assistant at all — the install's mode, `on` or `off` even
// TEST_OVERVIEW: where the settings tab hides the switch, and the person's own
// TEST_OVERVIEW: switch in `experimental` — and whether it has been used, which a
// TEST_OVERVIEW: Session that just appeared marks here so a New chat does not bring
// TEST_OVERVIEW: the greeting back. An answer that was on its way when the mark was
// TEST_OVERVIEW: set cannot take the mark back, and only the server's own `used`
// TEST_OVERVIEW: answer retires the local one, so a reset shows the greeting again.
import { describe, expect, it } from "vitest";

import {
  assistantGate,
  assistantStateFor,
  markAssistantUsed,
  usedAfterLocalMark,
} from "../../modules/assistants/api/assistant-state.js";
import { queryClient } from "../../query-client.js";
import { trpc } from "../../trpc.js";

const ASSISTANT = "agent-00000000000000a1";

describe("whether the person has the assistant", () => {
  // TEST_SCENARIO: an install that pins the feature on offers it to everyone, whatever the tab shows; one that pins it off offers it to nobody, whatever a stored switch says.
  it("follows a pinned mode without waiting for a switch", () => {
    expect(assistantGate("on", undefined)).toEqual({ on: true, known: true });
    expect(assistantGate("off", true)).toEqual({ on: false, known: true });
  });

  // TEST_SCENARIO: in `experimental` the person's own switch decides, and neither answer is known until it has been read.
  it("follows the person's own switch in experimental", () => {
    expect(assistantGate("experimental", undefined)).toEqual({
      on: false,
      known: false,
    });
    expect(assistantGate("experimental", true)).toEqual({
      on: true,
      known: true,
    });
    expect(assistantGate("experimental", false)).toEqual({
      on: false,
      known: true,
    });
  });

  // TEST_SCENARIO: an install that has not answered yet is not a "no": the landing and the greeting wait.
  it("knows nothing until the install answers", () => {
    expect(assistantGate(undefined, true)).toEqual({ on: false, known: false });
  });
});

describe("the record's used mark", () => {
  // TEST_SCENARIO: the first Session of the chat appears before the api-server has learned of it, so the cached record learns it here.
  it("marks the cached record used", () => {
    const key = trpc.assistants.state.queryKey();
    const row = { agentId: ASSISTANT, used: false };
    queryClient.setQueryData(key, row);
    markAssistantUsed(ASSISTANT);
    expect(queryClient.getQueryData(key)).toEqual({ ...row, used: true });
  });

  // TEST_SCENARIO: an answer that was in flight when the tab sent its first message — or one from a replica that has not seen the report — carries `used: false`, and must not take the mark back.
  it("keeps the mark against an older answer", () => {
    const marked = new Set([ASSISTANT]);
    expect(
      usedAfterLocalMark({ agentId: ASSISTANT, used: false }, marked),
    ).toEqual({ agentId: ASSISTANT, used: true });
    expect(
      usedAfterLocalMark({ agentId: "agent-2", used: false }, marked),
    ).toEqual({ agentId: "agent-2", used: false });
    expect(usedAfterLocalMark(null, marked)).toBeNull();
  });

  // TEST_SCENARIO: the server's own "used" answer retires the local mark, so after a reset — the server saying unused again — the greeting and the landing come back in the same page load.
  it("retires the mark once the server says used, so a reset shows the greeting", () => {
    markAssistantUsed(ASSISTANT);
    expect(assistantStateFor({ agentId: ASSISTANT, used: true })).toEqual({
      agentId: ASSISTANT,
      used: true,
    });
    expect(assistantStateFor({ agentId: ASSISTANT, used: false })).toEqual({
      agentId: ASSISTANT,
      used: false,
    });
  });

  // TEST_SCENARIO: a session on another Agent is not the assistant's, so a record that does not name it is left alone.
  it("leaves a record that names another agent alone", () => {
    const key = trpc.assistants.state.queryKey();
    const row = { agentId: ASSISTANT, used: false };
    queryClient.setQueryData(key, row);
    markAssistantUsed("agent-2");
    expect(queryClient.getQueryData(key)).toEqual(row);
  });
});
