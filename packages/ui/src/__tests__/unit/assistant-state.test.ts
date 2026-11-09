// @vitest-environment happy-dom
// TEST_OVERVIEW: the assistant's state as the client keeps it: whether the person
// TEST_OVERVIEW: has an assistant at all — the install's mode, `on` or `off` even
// TEST_OVERVIEW: where the settings tab hides the switch, and the person's own
// TEST_OVERVIEW: switch in `experimental` — and whether it has been used, which a
// TEST_OVERVIEW: Session that just appeared marks here so a New chat does not bring
// TEST_OVERVIEW: the greeting back. An answer that was on its way when the mark was
// TEST_OVERVIEW: set cannot take the mark back, while a reset — this tab's, or
// TEST_OVERVIEW: another tab's newer onboarding epoch — clears it, so the greeting
// TEST_OVERVIEW: and the first landing come back.
import { beforeEach, describe, expect, it } from "vitest";

import {
  assistantGate,
  assistantStateFor,
  forgetAssistantUsed,
  markAssistantUsed,
  usedAfterLocalMark,
} from "../../modules/assistants/api/assistant-state.js";
import { greetingShown } from "../../modules/assistants/lib/greeting.js";
import { queryClient } from "../../query-client.js";
import { trpc } from "../../trpc.js";

const ASSISTANT = "agent-00000000000000a1";
const RESET = "2026-11-09T12:00:00.000Z";

type Record = { agentId: string; used: boolean; resetAt: string | null };

const record = (used: boolean, resetAt: string | null = null): Record => ({
  agentId: ASSISTANT,
  used,
  resetAt,
});

const cached = () =>
  queryClient.getQueryData<Record>(trpc.assistants.state.queryKey());

function greetingWouldShow(state: Record | null | undefined): boolean {
  return greetingShown({
    assistantOn: true,
    assistantId: state?.agentId ?? null,
    selectedAgent: ASSISTANT,
    used: state?.used,
  });
}

beforeEach(() => {
  forgetAssistantUsed();
  queryClient.removeQueries({ queryKey: trpc.assistants.state.queryKey() });
});

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
    const row = record(false);
    queryClient.setQueryData(trpc.assistants.state.queryKey(), row);
    markAssistantUsed(ASSISTANT);
    expect(cached()).toEqual({ ...row, used: true });
  });

  // TEST_SCENARIO: the tab's own optimistic write is read back by its mounted observer, which must not take the mark away with it; so an answer that was in flight when the tab sent its first message — or one from a replica that has not seen the report — carries `used: false` at the same onboarding epoch, and must not bring the greeting back either.
  it("keeps the mark through its own optimistic write and a stale answer", () => {
    queryClient.setQueryData(trpc.assistants.state.queryKey(), record(false));
    markAssistantUsed(ASSISTANT);
    // UNIT_BOUNDARY_DESCRIPTION: the mounted observer reads the optimistic record back, and that read must keep the mark rather than retire it.
    expect(assistantStateFor(cached())).toEqual(record(true));
    expect(assistantStateFor(record(false))).toEqual(record(true));
    expect(greetingWouldShow(assistantStateFor(record(false)))).toBe(false);
  });

  // TEST_SCENARIO: a record naming another Agent is not the one the mark was made for.
  it("leaves another agent's record alone", () => {
    const other = { ...record(false), agentId: "agent-2" };
    expect(assistantStateFor(other)).toEqual(other);
  });

  // TEST_SCENARIO: the person confirms Reset user onboarding in this tab, so the mark it made for the message that brought them there goes before the record is read again: the greeting and the landing are back in the same page load.
  it("is cleared by this tab's own reset, so the greeting returns", () => {
    queryClient.setQueryData(trpc.assistants.state.queryKey(), record(false));
    markAssistantUsed(ASSISTANT);
    forgetAssistantUsed();
    const after = assistantStateFor(record(false, RESET));
    expect(after).toEqual(record(false, RESET));
    expect(greetingWouldShow(after)).toBe(true);
  });

  // TEST_SCENARIO: another tab resets while this one still holds its mark; the record answers `used: false` at a newer onboarding epoch, and that epoch — not the mark — decides, so the greeting comes back here too.
  it("is cleared by another tab's reset, which moved the epoch", () => {
    queryClient.setQueryData(trpc.assistants.state.queryKey(), record(true));
    markAssistantUsed(ASSISTANT);
    expect(assistantStateFor(record(false))).toEqual(record(true));
    const reset = record(false, RESET);
    expect(assistantStateFor(reset)).toEqual(reset);
    expect(greetingWouldShow(assistantStateFor(reset))).toBe(true);
  });

  // TEST_SCENARIO: a mark made while the record was not in the cache cannot say which onboarding it belongs to, so an answer carrying an epoch retires it rather than hiding the greeting a reset just brought back.
  it("retires a mark made without a record", () => {
    markAssistantUsed(ASSISTANT);
    expect(assistantStateFor(record(false, RESET))).toEqual(
      record(false, RESET),
    );
  });

  // TEST_SCENARIO: an answer that says the assistant is used is passed on as the server sent it, and the mark stays — it is the reset's epoch, not that answer, that ends it — so a later stale answer still reads as used.
  it("passes a used answer on and keeps the mark for the same epoch", () => {
    queryClient.setQueryData(trpc.assistants.state.queryKey(), record(false));
    markAssistantUsed(ASSISTANT);
    expect(assistantStateFor(record(true))).toEqual(record(true));
    expect(assistantStateFor(record(false))).toEqual(record(true));
  });

  // TEST_SCENARIO: a record with no mark on it is answered exactly as the server sent it.
  it("answers an unmarked record as the server sent it", () => {
    expect(usedAfterLocalMark(record(false), new Map())).toEqual(record(false));
    expect(usedAfterLocalMark(null, new Map())).toBeNull();
  });
});
