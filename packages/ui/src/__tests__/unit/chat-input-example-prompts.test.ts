// @vitest-environment happy-dom
// TEST_OVERVIEW: An empty composer in a new chat shows example prompts in place of its placeholder, one after another, as the design hand-off draws it: each fades out after a few seconds and the next fades in. Tab puts the one showing now in the composer, and the composer has focus when the chat opens. The examples are the design hand-off's list. Typed text, a running turn, a blocked composer or a chat that passes no examples shows the ordinary placeholder, which stays the composer's accessible name throughout.
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../modules/agents/api/skills.js", () => ({
  useSkillsState: () => ({ data: undefined }),
}));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { ChatInput } =
  await import("../../modules/sessions/components/chat-input.js");
const { EXAMPLE_FADE_MS, EXAMPLE_PROMPTS, EXAMPLE_SHOWN_MS } =
  await import("../../modules/sessions/lib/example-prompts.js");
const { useStore } = await import("../../store.js");
const { draftKey } = await import("../../modules/sessions/lib/draft-key.js");

const KEY = draftKey("agent-1", null);

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const EXAMPLES = ["Summarize my week", "Draft a release note"];

function render(
  props: {
    examples?: readonly string[] | null;
    busy?: boolean;
    blockedReason?: string | null;
  } = {},
) {
  const textareaRef = createRef<HTMLTextAreaElement>();
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ChatInput, {
          textareaRef,
          busy: props.busy ?? false,
          loadingSession: false,
          onSend: () => {},
          onStop: () => {},
          examples: props.examples === undefined ? EXAMPLES : props.examples,
          blockedReason: props.blockedReason ?? null,
        }),
      ),
    ),
  );
}

const textarea = () => host.querySelector("textarea")!;
const hint = () =>
  host.querySelector<HTMLElement>('[data-testid="example-prompt"]');
const hintText = () => hint()?.querySelector("span")?.textContent ?? null;
const shownOf = (examples: readonly string[]) => examples.includes(hintText()!);
const fading = () => hint()!.className.includes("opacity-0");

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    textarea().dispatchEvent(event);
  });
  return event;
}

function draftText() {
  return useStore.getState().drafts[KEY]?.text ?? "";
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal(
    "matchMedia",
    () =>
      ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  useStore.setState({
    selectedAgent: "agent-1",
    sessionId: null,
    drafts: {},
    messages: [],
    reportedCommands: null,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the example prompt of an empty composer", () => {
  // TEST_SCENARIO: a new chat opens with the composer focused and the first example drawn over it, with the Tab hint; the placeholder stays the composer's accessible name but is not drawn under the example.
  it("shows one example in a focused composer", () => {
    render();
    expect(document.activeElement).toBe(textarea());
    expect(shownOf(EXAMPLES)).toBe(true);
    expect(hint()!.textContent).toContain("Tab");
    expect(hint()!.getAttribute("aria-hidden")).toBe("true");
    expect(textarea().placeholder).toBe("Message…");
    expect(textarea().className).toContain("placeholder:text-transparent");
  });

  // TEST_SCENARIO: after the shown time the example fades out, and after the fade the next one takes its place, fully shown; after the last one the first comes back.
  it("fades to the next example and wraps around", () => {
    render();
    expect(hintText()).toBe("Summarize my week");
    advance(EXAMPLE_SHOWN_MS);
    expect(fading()).toBe(true);
    advance(EXAMPLE_FADE_MS);
    expect(fading()).toBe(false);
    expect(hintText()).toBe("Draft a release note");
    advance(EXAMPLE_SHOWN_MS + EXAMPLE_FADE_MS);
    expect(hintText()).toBe("Summarize my week");
  });

  // TEST_SCENARIO: Tab puts the example showing now, here the second one, in the composer and keeps focus there; the example is gone once the composer holds text, so a second Tab moves on as usual.
  it("puts the shown example in the composer on Tab", () => {
    render();
    advance(EXAMPLE_SHOWN_MS + EXAMPLE_FADE_MS);
    const shown = hintText()!;
    expect(shown).toBe("Draft a release note");
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(draftText()).toBe(shown);
    expect(textarea().value).toBe(shown);
    expect(hint()).toBeNull();
    expect(press("Tab").defaultPrevented).toBe(false);
  });

  // TEST_SCENARIO: Shift+Tab is never taken, so focus can still leave the composer backwards.
  it("leaves Shift+Tab alone", () => {
    render();
    expect(press("Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(draftText()).toBe("");
  });
});

describe("when the composer shows its ordinary placeholder", () => {
  // TEST_SCENARIO: a chat that passes no examples, as an existing conversation or a greeting with its own placeholder does, shows the placeholder and Tab inserts nothing.
  it("shows no example when the chat passes none", () => {
    render({ examples: null });
    expect(hint()).toBeNull();
    expect(textarea().className).not.toContain("placeholder:text-transparent");
    expect(press("Tab").defaultPrevented).toBe(false);
  });

  // TEST_SCENARIO: a running turn turns the composer into a queue, so it hints Queue a message and no example.
  it("shows no example while a turn runs", () => {
    render({ busy: true });
    expect(hint()).toBeNull();
    expect(textarea().placeholder).toBe("Queue a message…");
  });

  // TEST_SCENARIO: a blocked composer names why in its placeholder, which an example would hide.
  it("shows no example while the composer is blocked", () => {
    render({ blockedReason: "Connect a provider to chat" });
    expect(hint()).toBeNull();
    expect(textarea().placeholder).toBe("Connect a provider to chat");
  });

  // TEST_SCENARIO: once the person types, the example goes, and clearing the text brings it back.
  it("hides the example while the composer holds text", () => {
    render();
    act(() => useStore.getState().setDraft(KEY, { text: "hi" }));
    expect(hint()).toBeNull();
    act(() => useStore.getState().setDraft(KEY, { text: "" }));
    expect(shownOf(EXAMPLES)).toBe(true);
  });
});

describe("the shipped examples", () => {
  // TEST_SCENARIO: the list is the design hand-off's seven examples, and its copy names no brand, so a rebranded install shows the same examples.
  it("are the design's, each naming no brand", () => {
    expect(EXAMPLE_PROMPTS.length).toBe(7);
    for (const text of EXAMPLE_PROMPTS) expect(text).not.toMatch(/\bdam\b/i);
  });
});
