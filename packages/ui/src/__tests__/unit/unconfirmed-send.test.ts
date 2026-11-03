// TEST_OVERVIEW: a sent message's reply says the message is on its way, not that the agent is working, until the runtime confirms it has the message. The runtime confirms with platform/promptAccepted or platform/promptStarted. Until then the reply shows "Sending…", or "Waking the agent…" when the send woke the agent, and no working dots and no quiet-turn line.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { applyUpdate } from "../../modules/acp/session-projection.js";
import { ChatMessage } from "../../modules/sessions/components/chat-message.js";
import { quietTurnOf } from "../../modules/sessions/lib/quiet-turn.js";
import type { Message } from "../../types.js";

vi.hoisted(() => vi.stubGlobal("window", new EventTarget()));

vi.mock("../../store.js", () => ({
  useStore: (select: (store: unknown) => unknown) =>
    select({ sessionId: null, pendingPermissions: [] }),
}));

const sent: Message = {
  id: "u1",
  role: "user",
  parts: [{ kind: "text", text: "hello" }],
  streaming: false,
  at: "2026-11-03T10:00:00.000Z",
};

function pendingReply(unconfirmed?: Message["unconfirmed"]): Message {
  return {
    id: "a1",
    role: "assistant",
    parts: [],
    streaming: true,
    promptId: "p1",
    ...(unconfirmed && { unconfirmed }),
  };
}

function render(message: Message): string {
  return renderToStaticMarkup(
    createElement(ChatMessage, {
      message,
      isLast: true,
      hasPendingPermission: false,
      onRetry: vi.fn(),
      onFileClick: vi.fn(),
      onDelete: vi.fn(),
    }),
  );
}

describe("a reply the runtime has not confirmed", () => {
  // TEST_SCENARIO: the agent is running and the message is on the wire. The chat must not claim the agent works on it yet, so it says "Sending…" and shows no working dots.
  test("says Sending, not that the agent is working", () => {
    const html = render(pendingReply("sending"));
    expect(html).toContain('data-testid="reply-unconfirmed"');
    expect(html).toContain("Sending…");
    expect(html).not.toContain('data-testid="working-dots"');
  });

  // TEST_SCENARIO: the send woke a sleeping agent, which takes up to a couple of minutes. The chat says the agent is waking, which is what the person is waiting for.
  test("says Waking the agent when the send woke it", () => {
    const html = render(pendingReply("waking"));
    expect(html).toContain("Waking the agent…");
    expect(html).not.toContain('data-testid="working-dots"');
  });

  // TEST_SCENARIO: a confirmed reply is the agent's own work, so it shows the working dots as before.
  test("shows the working dots once confirmed", () => {
    const html = render(pendingReply());
    expect(html).not.toContain('data-testid="reply-unconfirmed"');
    expect(html).toContain('data-testid="working-dots"');
  });

  // TEST_SCENARIO: the quiet-turn line reads the time since the prompt as the agent's silence. A message the agent does not have yet is not a silent turn, so the line stays away.
  test("is not counted as a quiet turn", () => {
    const later = new Date("2026-11-03T10:10:00.000Z");
    expect(
      quietTurnOf({
        messages: [sent, pendingReply("waking")],
        lastOutputAt: null,
        now: later,
      }),
    ).toBeNull();
    expect(
      quietTurnOf({
        messages: [sent, pendingReply()],
        lastOutputAt: null,
        now: later,
      }),
    ).not.toBeNull();
  });
});

describe("the runtime's confirmation", () => {
  // TEST_SCENARIO: platform/promptAccepted is the runtime saying it has the message, so the reply turns into the agent's working reply.
  test("an accepted prompt is confirmed", () => {
    const out = applyUpdate([sent, pendingReply("sending")], {
      sessionUpdate: "platform_prompt_accepted",
      sessionId: "s1",
      promptId: "p1",
      queued: false,
    });
    expect(out[1]?.unconfirmed).toBeUndefined();
    expect(out[1]?.streaming).toBe(true);
  });

  // TEST_SCENARIO: a prompt queued behind a running turn is still one the runtime has; it reads as queued, not as still sending.
  test("a queued prompt is confirmed too", () => {
    const running: Message = {
      id: "a0",
      role: "assistant",
      parts: [{ kind: "text", text: "working" }],
      streaming: true,
      promptId: "p0",
    };
    const out = applyUpdate([running, sent, pendingReply("sending")], {
      sessionUpdate: "platform_prompt_accepted",
      sessionId: "s1",
      promptId: "p1",
      queued: true,
    });
    expect(out[2]?.unconfirmed).toBeUndefined();
    expect(out[2]?.queued).toBe(true);
  });

  // TEST_SCENARIO: a started prompt whose acceptance frame was missed is confirmed by platform/promptStarted alone.
  test("a started prompt is confirmed", () => {
    const out = applyUpdate([sent, pendingReply("waking")], {
      sessionUpdate: "platform_prompt_started",
      sessionId: "s1",
      promptId: "p1",
    });
    expect(out[1]?.unconfirmed).toBeUndefined();
  });

  // TEST_SCENARIO: another prompt's confirmation leaves this one waiting.
  test("another prompt's confirmation changes nothing", () => {
    const start = [sent, pendingReply("sending")];
    const out = applyUpdate(start, {
      sessionUpdate: "platform_prompt_accepted",
      sessionId: "s1",
      promptId: "other",
      queued: false,
    });
    expect(out[1]?.unconfirmed).toBe("sending");
  });
});
