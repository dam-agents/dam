// @vitest-environment happy-dom
// TEST_OVERVIEW: the greeting an unused assistant opens its chat with: who it is
// TEST_OVERVIEW: and which brand it belongs to, said to the signed-in person by
// TEST_OVERVIEW: name, the ask to hear about their role, and tasks that need
// TEST_OVERVIEW: neither a connection nor personal context. It belongs to the
// TEST_OVERVIEW: owner's own assistant, only while neither the row's used mark
// TEST_OVERVIEW: nor the Agent's own session list says it ever had a session — a
// TEST_OVERVIEW: mark a Session that just appeared sets at once, so a New chat
// TEST_OVERVIEW: does not bring the greeting back. A task goes into the composer
// TEST_OVERVIEW: and sends nothing.
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
  kind: "assistant" as const,
  assistantOn: true,
  assistantId: ASSISTANT,
  selectedAgent: ASSISTANT,
  used: false,
  sessionsListed: 0,
};

const copy = greetingCopy({
  firstName: "Jenna",
  assistantName: "Dambledore",
  brandName: "DAM",
});

describe("when the greeting is shown", () => {
  // TEST_SCENARIO: the owner's own assistant, never used and listing no session, with the feature on for them: the chat opens with the greeting.
  it("is shown to an unused assistant of the owner, with the feature on", () => {
    expect(greetingShown(ON)).toBe(true);
  });

  // TEST_SCENARIO: the feature off for the person, another agent, an agent that is not an assistant at all, an assistant that already had a session, and an install that has not recorded an assistant each leave the chat as it was.
  it("is shown for nothing else", () => {
    expect(greetingShown({ ...ON, assistantOn: false })).toBe(false);
    expect(greetingShown({ ...ON, kind: null })).toBe(false);
    expect(greetingShown({ ...ON, kind: "knowledge-base" })).toBe(false);
    expect(greetingShown({ ...ON, selectedAgent: "agent-2" })).toBe(false);
    expect(greetingShown({ ...ON, assistantId: null })).toBe(false);
    expect(greetingShown({ ...ON, selectedAgent: null })).toBe(false);
    expect(greetingShown({ ...ON, used: true })).toBe(false);
    expect(greetingShown({ ...ON, used: undefined })).toBe(false);
  });

  // TEST_SCENARIO: the row's mark can lag the Session that just started, and the Agent's own list is the answer that does not: one session listed hides the greeting, and so does a list that has not answered.
  it("is hidden by a session the Agent already lists", () => {
    expect(greetingShown({ ...ON, sessionsListed: 1 })).toBe(false);
    expect(greetingShown({ ...ON, sessionsListed: undefined })).toBe(false);
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

describe("the assistant's used mark", () => {
  // TEST_SCENARIO: the first Session of the chat appears before the api-server has learned of it, so the cached row learns it here — and the greeting's own gate then stays shut for a New chat in the same page load.
  it("closes the gate the moment a session exists", () => {
    const key = trpc.assistants.state.queryKey();
    const row = { agentId: ASSISTANT, used: false, notice: null };
    queryClient.setQueryData(key, row);
    markAssistantUsed(ASSISTANT);
    expect(queryClient.getQueryData(key)).toEqual({ ...row, used: true });

    const marked = queryClient.getQueryData<typeof row>(key);
    expect(
      greetingShown({ ...ON, used: marked?.used, sessionsListed: 0 }),
    ).toBe(false);
  });

  // TEST_SCENARIO: a session on another Agent is not the assistant's, so the row it does not name is left alone.
  it("leaves a row that names another agent alone", () => {
    const key = trpc.assistants.state.queryKey();
    const row = { agentId: ASSISTANT, used: false, notice: null };
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
