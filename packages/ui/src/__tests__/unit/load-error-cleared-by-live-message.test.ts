// @vitest-environment happy-dom
// TEST_OVERVIEW: A Session whose load failed may still be working, and its live messages reach the chat. The first live message of the shown Session takes its load error away, so the "Can't open this conversation" card does not stay above the messages that prove it opens. A message of another Session, or an update that shows no message, leaves the error as it is.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AcpUpdate, UpdateHandler } from "../../modules/acp/types.js";
import { useAcpUpdateHandler } from "../../modules/sessions/hooks/use-acp-update-handler.js";
import type { Message } from "../../types.js";

const h = vi.hoisted(() => {
  const state = {
    sessionId: "s1" as string | null,
    messages: [] as unknown[],
    sessionError: null as { sessionId: string; kind: string } | null,
    rewritePending: null,
    pendingPermissions: [],
    setMessages: (m: unknown[] | ((prev: unknown[]) => unknown[])) =>
      (state.messages = typeof m === "function" ? m(state.messages) : m),
    setSessionError: (e: typeof state.sessionError) => (state.sessionError = e),
    setLastOutputAt: () => {},
    setQueuedPrompts: () => {},
    setTurnSender: () => {},
    setReportedCommands: () => {},
  };
  return { state };
});

vi.mock("../../store.js", () => ({
  useStore: Object.assign(
    (select: (s: typeof h.state) => unknown) => select(h.state),
    { getState: () => h.state },
  ),
}));

const chunk = {
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text: "working on it" },
} as AcpUpdate;

function handler(onLoadErrorCleared: (sid: string) => void): UpdateHandler {
  let make: (() => UpdateHandler) | undefined;
  function TestChat() {
    make = useAcpUpdateHandler(() => {}, onLoadErrorCleared);
    return null;
  }
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(TestChat)));
  const made = make!();
  act(() => root.unmount());
  return made;
}

describe("a live message of a Session that would not load", () => {
  beforeEach(() => {
    h.state.sessionId = "s1";
    h.state.messages = [];
    h.state.sessionError = { sessionId: "s1", kind: "other" };
  });

  // TEST_SCENARIO: the shown Session failed to load and the agent posts a message in it. The card goes away, the message shows, and the chat is told so it can read the history again.
  it("takes the load error away and shows the message", () => {
    const cleared = vi.fn();
    handler(cleared)(chunk, "s1");
    expect(h.state.sessionError).toBeNull();
    expect(cleared).toHaveBeenCalledWith("s1");
    expect(
      (h.state.messages as Message[]).some((m) =>
        m.parts.some((p) => "text" in p && p.text === "working on it"),
      ),
    ).toBe(true);
  });

  // TEST_SCENARIO: an update that is not a message, such as the Session's command list, says nothing about its history, so the card stays.
  it("keeps the error on an update that shows no message", () => {
    const cleared = vi.fn();
    handler(cleared)(
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [],
      } as AcpUpdate,
      "s1",
    );
    expect(h.state.sessionError).toEqual({ sessionId: "s1", kind: "other" });
    expect(cleared).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the error belongs to another Session than the one the message is for, so it stays.
  it("keeps another Session's error", () => {
    h.state.sessionId = null;
    h.state.sessionError = { sessionId: "s2", kind: "other" };
    const cleared = vi.fn();
    handler(cleared)(chunk, "s1");
    expect(h.state.sessionError).toEqual({ sessionId: "s2", kind: "other" });
    expect(cleared).not.toHaveBeenCalled();
  });
});
