// @vitest-environment happy-dom
// TEST_OVERVIEW: the composer's empty placeholder: "Message…" for an ordinary
// TEST_OVERVIEW: chat, the example task the assistant's greeting offers while
// TEST_OVERVIEW: that greeting is up, and the block that explains why the
// TEST_OVERVIEW: composer cannot take a message in place of either.
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commands = vi.hoisted(() => ({
  state: { installed: [], standalone: [], instancePublishes: [] },
}));

vi.mock("../../modules/agents/api/skills.js", () => ({
  useSkillsState: () => ({ data: commands.state }),
}));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { ChatInput } =
  await import("../../modules/sessions/components/chat-input.js");
const { useStore } = await import("../../store.js");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function render(emptyPlaceholder: string | null, blockedReason?: string) {
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
          onSend: () => {},
          onStop: () => {},
          emptyPlaceholder,
          blockedReason,
        }),
      ),
    ),
  );
}

const placeholder = () => host.querySelector("textarea")!.placeholder;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
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
});

describe("the composer's empty placeholder", () => {
  // TEST_SCENARIO: an ordinary chat hints the message box is for a message.
  it("says Message… for a chat with nothing to suggest", () => {
    render(null);
    expect(placeholder()).toBe("Message…");
  });

  // TEST_SCENARIO: while the assistant's greeting is up, the box shows one of the tasks it offers, as the design has it.
  it("shows the greeting's example task while the greeting is up", () => {
    render("Remember I like answers short and technical");
    expect(placeholder()).toBe("Remember I like answers short and technical");
  });

  // TEST_SCENARIO: a composer that cannot take a message says why, whatever it would have hinted.
  it("says why the composer is blocked instead", () => {
    render(
      "Remember I like answers short and technical",
      "Connect a provider to send",
    );
    expect(placeholder()).toBe("Connect a provider to send");
  });
});
