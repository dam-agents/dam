// @vitest-environment happy-dom
// TEST_OVERVIEW: the greeting an unused assistant opens its chat with: who it is
// TEST_OVERVIEW: and which brand it belongs to, said to the signed-in person by
// TEST_OVERVIEW: name, the ask to hear about their role, and tasks that need
// TEST_OVERVIEW: neither a connection nor personal context. It belongs to the
// TEST_OVERVIEW: owner's own assistant, only while that assistant has never had
// TEST_OVERVIEW: a session; a task goes into the composer and sends nothing; and
// TEST_OVERVIEW: the owner's first turn carries the greeting to the agent as
// TEST_OVERVIEW: context the transcript hides.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stripPlumbing } from "../../modules/acp/session-projection.js";
import { AssistantGreeting } from "../../modules/assistants/components/assistant-greeting.js";
import {
  GREETING_PLACEHOLDER,
  GREETING_SUGGESTIONS,
  greetingCopy,
  greetingPrompt,
  greetingShown,
} from "../../modules/assistants/lib/greeting.js";
import { draftKey } from "../../modules/sessions/lib/draft-key.js";
import { useStore } from "../../store.js";

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

  // TEST_SCENARIO: the feature off for the person, another agent, an assistant that already had a session, and an install that has not recorded an assistant each leave the chat as it was.
  it("is shown for nothing else", () => {
    expect(greetingShown({ ...ON, assistantOn: false })).toBe(false);
    expect(greetingShown({ ...ON, selectedAgent: "agent-2" })).toBe(false);
    expect(greetingShown({ ...ON, assistantId: null })).toBe(false);
    expect(greetingShown({ ...ON, selectedAgent: null })).toBe(false);
    expect(greetingShown({ ...ON, used: true })).toBe(false);
    expect(greetingShown({ ...ON, used: undefined })).toBe(false);
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
    expect(
      greetingCopy({
        firstName: null,
        assistantName: "Dambledore",
        brandName: "DAM",
      }).paragraphs[0],
    ).toBe("Hi! I'm Dambledore, your new personal DAM agent!");
    expect(
      greetingCopy({
        firstName: "  ",
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
  });
});

describe("what the agent receives", () => {
  // TEST_SCENARIO: the platform wrote the opening of the chat, not the person, so the agent is told what it said and what it offered; the transcript shows none of it.
  it("carries the greeting and the tasks as hidden context", () => {
    expect(copy.context).toContain(copy.paragraphs[0]);
    expect(copy.context).toContain(copy.paragraphs[1]);
    for (const task of GREETING_SUGGESTIONS)
      expect(copy.context).toContain(task);
    expect(stripPlumbing(copy.context)).toBe("");
  });

  // TEST_SCENARIO: a first turn that is only an attachment has nothing to join, so the context is the whole prompt rather than a block under blank lines.
  it("joins the person's own text, and stands alone when there is none", () => {
    expect(greetingPrompt("Remember I like answers short", copy.context)).toBe(
      `Remember I like answers short\n\n${copy.context}`,
    );
    expect(greetingPrompt("", copy.context)).toBe(copy.context);
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
});

describe("picking a task", () => {
  // TEST_SCENARIO: a click on a chip puts its text in the composer of this chat and stops there, so nothing runs before the person acts.
  it("fills the composer without sending", () => {
    const chips = [...host.querySelectorAll("button")];
    const task = GREETING_SUGGESTIONS[0];
    const chip = chips.find((button) => button.textContent === task);
    expect(chip).toBeDefined();
    act(() => {
      chip!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useStore.getState().drafts[draftKey(ASSISTANT, null)]?.text).toBe(
      task,
    );
    expect(useStore.getState().messages).toEqual([]);
    expect(picked).toHaveBeenCalledOnce();
  });

  // TEST_SCENARIO: the greeting itself is shown with the assistant's own name above it and one chip per task.
  it("shows the assistant above the message, one chip per task", () => {
    expect(host.textContent).toContain("Dambledore");
    expect(host.textContent).toContain(copy.paragraphs[0]);
    const chips = [...host.querySelectorAll("button")].filter((button) =>
      GREETING_SUGGESTIONS.some((task) => button.textContent === task),
    );
    expect(chips).toHaveLength(GREETING_SUGGESTIONS.length);
  });
});
