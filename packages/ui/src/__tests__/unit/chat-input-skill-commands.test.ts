// @vitest-environment happy-dom
// TEST_OVERVIEW: In the chat input, a `/` at the start opens a list of the commands this agent can run: the skills of the agent when its harness runs `/<skill-name>`, and the commands the harness reported for the session. Typing filters it. ↑/↓ move through it, Enter or Tab picks, Esc closes it, and a click picks too; a pick puts `/<name> ` in the input with the caret after it. While the list is closed, Enter sends the prompt as before. A harness that does not run skill commands offers only what it reported.
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const skills = vi.hoisted(() => ({
  state: {
    installed: [{ source: "src", name: "pr-open", version: "v1" }],
    standalone: [
      {
        name: "grill-me",
        description: "Interview the user about a plan",
        skillPath: "/skills",
      },
      {
        name: "review",
        description: "Review the diff",
        skillPath: "/skills",
      },
    ],
    instancePublishes: [],
  },
  askedFor: [] as (string | null)[],
}));

vi.mock("../../modules/agents/api/skills.js", () => ({
  useSkillsState: (agentId: string | null) => {
    skills.askedFor.push(agentId);
    return { data: agentId ? skills.state : undefined };
  },
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

function render(harness: string | null) {
  const textareaRef = createRef<HTMLTextAreaElement>();
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ChatInput, {
          textareaRef,
          busy: false,
          loadingSession: false,
          onSend,
          onStop: () => {},
          harness,
        }),
      ),
    ),
  );
}

const textarea = () => host.querySelector("textarea")!;
const listbox = () => host.querySelector('[role="listbox"]');
const optionNames = () =>
  [...host.querySelectorAll('[role="option"]')].map(
    (o) => o.querySelector("span")!.textContent,
  );
const highlighted = () =>
  host
    .querySelector('[role="option"][aria-selected="true"]')
    ?.querySelector("span")?.textContent;

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
  flushFrames();
  return event;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1280);
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  skills.askedFor = [];
  useStore.setState({
    selectedAgent: "agent-1",
    sessionId: "session-1",
    drafts: {},
    messages: [],
    reportedCommands: null,
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

describe("the command list of the chat input", () => {
  // TEST_SCENARIO: on a Claude Code agent, `/` lists its skills by name with their descriptions, and the input is a combobox that controls the list.
  it("lists the agent's skills after a slash", () => {
    render("claude-code");
    type("/");
    expect(optionNames()).toEqual(["/grill-me", "/pr-open", "/review"]);
    expect(listbox()!.textContent).toContain("Interview the user about a plan");
    expect(textarea().getAttribute("role")).toBe("combobox");
    expect(textarea().getAttribute("aria-expanded")).toBe("true");
    expect(textarea().getAttribute("aria-controls")).toBe(listbox()!.id);
  });

  // TEST_SCENARIO: `/gri` filters the list to grill-me, and Enter picks it: the input holds `/grill-me ` with the caret after the space, the list closes, and nothing is sent.
  it("filters as the user types and picks with Enter", () => {
    render("claude-code");
    type("/gri");
    expect(optionNames()).toEqual(["/grill-me"]);
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(textarea().value).toBe("/grill-me ");
    expect(textarea().selectionStart).toBe(10);
    expect(listbox()).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: ↓ and ↑ move the highlight, wrap at the ends, and the active option is the input's aria-activedescendant; Tab picks the highlighted one.
  it("moves with the arrow keys and picks with Tab", () => {
    render("claude-code");
    type("/");
    expect(highlighted()).toBe("/grill-me");
    press("ArrowDown");
    expect(highlighted()).toBe("/pr-open");
    const active = textarea().getAttribute("aria-activedescendant");
    expect(host.querySelector(`[id="${active}"]`)!.textContent).toContain(
      "/pr-open",
    );
    press("ArrowUp");
    press("ArrowUp");
    expect(highlighted()).toBe("/review");
    press("Tab");
    expect(textarea().value).toBe("/review ");
  });

  // TEST_SCENARIO: Esc closes the list without clearing the input, and then Enter sends the prompt as typed.
  it("closes on Escape, and Enter then sends", () => {
    render("claude-code");
    type("/gri");
    press("Escape");
    expect(listbox()).toBeNull();
    expect(textarea().value).toBe("/gri");
    press("Enter");
    expect(onSend).toHaveBeenCalledWith("/gri", undefined);
  });

  // TEST_SCENARIO: a click on an option picks it.
  it("picks an option on click", () => {
    render("claude-code");
    type("/");
    const option = [...host.querySelectorAll('[role="option"]')][2]!;
    act(() => (option as HTMLElement).click());
    flushFrames();
    expect(textarea().value).toBe("/review ");
  });

  // TEST_SCENARIO: once the user types a space after the name, the list closes and Enter sends the whole prompt.
  it("sends with Enter once the name is followed by text", () => {
    render("claude-code");
    type("/review the change");
    expect(listbox()).toBeNull();
    press("Enter");
    expect(onSend).toHaveBeenCalledWith("/review the change", undefined);
  });

  // TEST_SCENARIO: a `/` inside a path does not open the list.
  it("stays closed for a path", () => {
    render("claude-code");
    type("look at src/");
    expect(listbox()).toBeNull();
  });

  // TEST_SCENARIO: the commands the harness reported for the session on screen join the skills, so built-ins show too.
  it("adds the commands the harness reported", () => {
    useStore
      .getState()
      .setReportedCommands("session-1", [
        { name: "compact", description: "Compact the conversation" },
      ]);
    render("claude-code");
    type("/co");
    expect(optionNames()).toEqual(["/compact"]);
  });

  // TEST_SCENARIO: commands reported for another session are not this session's, so they are not offered.
  it("ignores commands reported for another session", () => {
    useStore
      .getState()
      .setReportedCommands("session-2", [
        { name: "compact", description: "Compact the conversation" },
      ]);
    render("claude-code");
    type("/co");
    expect(listbox()).toBeNull();
  });

  // TEST_SCENARIO: a harness that does not run `/<skill-name>` neither reads the skills nor lists them, and with nothing reported, the input is a plain text box.
  it("offers no skills for another harness", () => {
    render("pi");
    type("/");
    expect(listbox()).toBeNull();
    expect(skills.askedFor.every((id) => id === null)).toBe(true);
    expect(textarea().getAttribute("role")).toBeNull();
  });

  // TEST_SCENARIO: a harness that reported its own commands offers just those.
  it("offers what another harness reported", () => {
    useStore
      .getState()
      .setReportedCommands("session-1", [
        { name: "compact", description: "Compact" },
      ]);
    render("pi");
    type("/");
    expect(optionNames()).toEqual(["/compact"]);
  });
});
