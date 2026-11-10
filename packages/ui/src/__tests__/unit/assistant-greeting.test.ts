// @vitest-environment happy-dom
// TEST_OVERVIEW: the greeting an unused assistant opens its chat with: who it is
// TEST_OVERVIEW: and which brand it belongs to, said to the signed-in person by
// TEST_OVERVIEW: name, the ask to hear about their role, and tasks that need
// TEST_OVERVIEW: neither a connection nor personal context. It belongs to the
// TEST_OVERVIEW: owner's own assistant, only while the record says it was never
// TEST_OVERVIEW: used — a mark a Session that just appeared sets at once, so a New
// TEST_OVERVIEW: chat does not bring the greeting back.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markAssistantUsed } from "../../modules/assistants/api/assistant-state.js";
import { AssistantGreeting } from "../../modules/assistants/components/assistant-greeting.js";
import {
  GREETING_PLACEHOLDER,
  GREETING_SUGGESTIONS,
  greetingCopy,
  greetingShown,
} from "../../modules/assistants/lib/greeting.js";
import { draftKey } from "../../modules/sessions/lib/draft-key.js";
import { queryClient } from "../../query-client.js";
import { useStore } from "../../store.js";
import { trpc } from "../../trpc.js";

const ASSISTANT = "agent-00000000000000a1";
const ON = {
  assistantOn: true,
  assistantId: ASSISTANT,
  selectedAgent: ASSISTANT,
  used: false,
};

const copy = greetingCopy({
  firstName: "Jenna",
  assistantName: "Dambledore",
  brandName: "DAM",
});

describe("when the greeting is shown", () => {
  // TEST_SCENARIO: the owner's own assistant, never used, with the feature on for them: the chat opens with the greeting.
  it("is shown to an unused assistant of the owner, with the feature on", () => {
    expect(greetingShown(ON)).toBe(true);
  });

  // TEST_SCENARIO: the feature off for the person, another agent, a record that names no assistant, and an assistant that has been used each leave the chat as it was.
  it("is shown for nothing else", () => {
    expect(greetingShown({ ...ON, assistantOn: false })).toBe(false);
    expect(greetingShown({ ...ON, selectedAgent: "agent-2" })).toBe(false);
    expect(greetingShown({ ...ON, assistantId: null })).toBe(false);
    expect(greetingShown({ ...ON, selectedAgent: null })).toBe(false);
    expect(greetingShown({ ...ON, used: true })).toBe(false);
    expect(greetingShown({ ...ON, used: undefined })).toBe(false);
  });

  // TEST_SCENARIO: the greeting rests on the record's mark alone, so it opens a New chat even when the assistant already has older sessions — and a reset, which clears the mark, brings it straight back.
  it("opens a New chat whatever sessions the assistant already has", () => {
    expect(greetingShown({ ...ON, used: false })).toBe(true);
    expect(greetingShown({ ...ON, used: true })).toBe(false);
    expect(greetingShown({ ...ON, used: false })).toBe(true);
  });
});

describe("what the greeting says", () => {
  // TEST_SCENARIO: the person's given name and the install's assistant and brand names, never a hardcoded one.
  it("names the person and the branded assistant", () => {
    expect(copy.paragraphs[0]).toBe(
      "Hi Jenna! I'm Dambledore, your new personal DAM agent!",
    );
  });

  // TEST_SCENARIO: a person whose profile holds no given name is greeted without one rather than by a made-up name.
  it("greets without a name when the profile has none", () => {
    for (const firstName of [null, "  "])
      expect(
        greetingCopy({
          firstName,
          assistantName: "Dambledore",
          brandName: "DAM",
        }).paragraphs[0],
      ).toBe("Hi! I'm Dambledore, your new personal DAM agent!");
  });

  // TEST_SCENARIO: the low-trust path offers tasks that need no connection and no personal context, one of them the composer's own example.
  it("asks about the owner's role and offers tasks needing nothing", () => {
    expect(copy.paragraphs[1]).toContain("Tell me a bit about your role");
    expect(copy.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(copy.suggestions).toContain(GREETING_PLACEHOLDER);
    expect(copy.placeholder).toBe(
      "Remember I like answers short and technical",
    );
    expect(GREETING_SUGGESTIONS).toEqual(copy.suggestions);
  });
});

describe("the record's used mark", () => {
  // TEST_SCENARIO: the first Session of the chat appears before the api-server has learned of it, so the cached record learns it here — and the greeting's own gate then stays shut for a New chat in the same page load.
  it("closes the gate the moment a session exists", () => {
    const key = trpc.assistants.state.queryKey();
    const row = { agentId: ASSISTANT, used: false, resetAt: null };
    queryClient.setQueryData(key, row);
    markAssistantUsed(ASSISTANT);
    expect(queryClient.getQueryData(key)).toEqual({ ...row, used: true });
    expect(
      greetingShown({
        ...ON,
        used: queryClient.getQueryData<typeof row>(key)?.used,
      }),
    ).toBe(false);
  });

  // TEST_SCENARIO: a session on another Agent is not the assistant's, so a record that does not name it is left alone.
  it("leaves a record that names another agent alone", () => {
    const key = trpc.assistants.state.queryKey();
    const row = { agentId: ASSISTANT, used: false, resetAt: null };
    queryClient.setQueryData(key, row);
    markAssistantUsed("agent-2");
    expect(queryClient.getQueryData(key)).toEqual(row);
  });
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let picked: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useStore.setState({ drafts: {}, messages: [] });
  picked = vi.fn<() => void>();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      createElement(AssistantGreeting, {
        greeting: copy,
        avatar: null,
        agentId: ASSISTANT,
        sessionId: null,
        onConfigure: () => {},
        onPicked: picked,
      }),
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore.setState({ drafts: {}, messages: [] });
  vi.unstubAllGlobals();
});

describe("the greeting in the chat", () => {
  // TEST_SCENARIO: the greeting is shown with the assistant's own name above it and one chip per task it offers.
  it("shows the assistant above the message, one chip per task", () => {
    expect(host.textContent).toContain("Dambledore");
    expect(host.textContent).toContain(copy.paragraphs[0]);
    const chips = [...host.querySelectorAll("button")].filter((button) =>
      GREETING_SUGGESTIONS.some((task) => button.textContent === task),
    );
    expect(chips).toHaveLength(GREETING_SUGGESTIONS.length);
  });

  // TEST_SCENARIO: a click on a chip puts its text in the composer of this chat and stops there, so nothing runs before the person acts.
  it("fills the composer without sending", () => {
    const task = GREETING_SUGGESTIONS[0];
    const chip = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === task,
    );
    expect(chip).toBeDefined();
    act(() => chip!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(useStore.getState().drafts[draftKey(ASSISTANT, null)]?.text).toBe(
      task,
    );
    expect(useStore.getState().messages).toEqual([]);
    expect(picked).toHaveBeenCalledOnce();
  });
});
