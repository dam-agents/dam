// @vitest-environment happy-dom
// TEST_OVERVIEW: a message typed into a chat that is still loading goes out once the conversation opens, so opening a sleeping agent's chat and pressing Enter loses nothing; a draft typed for one conversation never goes out in another.
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../modules/agents/api/skills.js", () => ({
  useSkillsState: () => ({ data: undefined }),
}));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { ChatInput } =
  await import("../../modules/sessions/components/chat-input.js");
const { useStore } = await import("../../store.js");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let onSend: ReturnType<
  typeof vi.fn<(text: string, attachments?: unknown[]) => void>
>;
let frames: FrameRequestCallback[] = [];

function flushFrames() {
  act(() => {
    for (const cb of frames.splice(0)) cb(0);
  });
}

function render(loadingSession: boolean) {
  const textareaRef = createRef<HTMLTextAreaElement>();
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ChatInput, {
          textareaRef,
          busy: false,
          loadingSession,
          onSend,
          onStop: () => {},
        }),
      ),
    ),
  );
}

const textarea = () => host.querySelector("textarea")!;

const valueSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "value",
)!.set!;

function type(text: string) {
  act(() => {
    const el = textarea();
    el.focus();
    valueSetter.call(el, text);
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressEnter() {
  act(() => {
    textarea().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  flushFrames();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1280);
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  useStore.setState({
    selectedAgent: "agent-1",
    sessionId: "session-1",
    drafts: {},
    messages: [],
    sessionError: null,
  });
  onSend = vi.fn<(text: string, attachments?: unknown[]) => void>();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("a send while the conversation loads", () => {
  // TEST_SCENARIO: opening a sleeping agent's chat shows "Loading session…" and the composer is usable; Enter then holds the message and sends it the moment the load ends, once.
  it("sends once the conversation has loaded", () => {
    render(true);
    type("EARLY-A: reply with exactly the word PUFFIN.");
    pressEnter();
    expect(onSend).not.toHaveBeenCalled();
    expect(useStore.getState().drafts["agent-1:session-1"]?.text).toBe(
      "EARLY-A: reply with exactly the word PUFFIN.",
    );

    render(false);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      "EARLY-A: reply with exactly the word PUFFIN.",
      undefined,
    );
    expect(
      useStore.getState().drafts["agent-1:session-1"]?.text,
    ).toBeUndefined();
  });

  // TEST_SCENARIO: after Enter the composer says the message goes out when the conversation opens, so the wait never reads as the dropped Enter the report describes.
  it("says the message is on its way once the conversation opens", () => {
    render(true);
    type("EARLY-A: reply with exactly the word PUFFIN.");
    pressEnter();
    expect(host.textContent).toContain(
      "Sending as soon as this conversation opens",
    );
  });

  // TEST_SCENARIO: a load that failed keeps the draft instead of sending into a conversation the red card says cannot be opened.
  it("keeps the draft when the load failed", () => {
    render(true);
    type("for a conversation that will not load");
    pressEnter();
    act(() =>
      useStore.setState({
        sessionError: { sessionId: "session-1", kind: "other" },
      }),
    );
    render(false);
    expect(onSend).not.toHaveBeenCalled();
    expect(useStore.getState().drafts["agent-1:session-1"]?.text).toBe(
      "for a conversation that will not load",
    );
  });

  // TEST_SCENARIO: a draft typed for one conversation is never sent into another one opened before its load ended; it stays in its own draft.
  it("stays in the draft of a conversation the person left", () => {
    render(true);
    type("for the first conversation");
    pressEnter();

    act(() => useStore.setState({ sessionId: "session-2" }));
    render(false);
    expect(onSend).not.toHaveBeenCalled();
    expect(useStore.getState().drafts["agent-1:session-1"]?.text).toBe(
      "for the first conversation",
    );
  });
});
