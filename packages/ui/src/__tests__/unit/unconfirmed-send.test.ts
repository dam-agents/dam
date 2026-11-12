// TEST_OVERVIEW: until the runtime confirms it has a sent message (platform/promptAccepted or platform/promptStarted), the chat says the message is on its way, never that the agent is working. The words sit under the person's own message: "Sending", or "Starting the agent" when the send woke the agent, shown only after a second so a fast send goes straight to the working dots. The agent's slot, the session's row in the sidebar and the quiet-turn line show nothing of the agent's until then.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  applyUpdate,
  hasWorkingReply,
} from "../../modules/acp/session-projection.js";
import { ChatMessage } from "../../modules/sessions/components/chat-message.js";
import { quietTurnOf } from "../../modules/sessions/lib/quiet-turn.js";
import type { Message } from "../../types.js";

vi.hoisted(() => vi.stubGlobal("window", new EventTarget()));

vi.mock("../../modules/sessions/hooks/use-spend-refusal-viewer.js", () => ({
  useSpendRefusalViewer: () => ({ role: "owner" }),
}));

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

describe("a send the runtime has not confirmed", () => {
  // TEST_SCENARIO: the agent is running and the message is on the wire. The words belong to the person's send, so "Sending" sits under their own message, and the agent's slot shows nothing yet: no name, no working dots.
  test("says Sending under the person's message, not in the agent's slot", () => {
    const html = render({ ...sent, unconfirmed: "sending" });
    expect(html).toContain('data-testid="send-unconfirmed"');
    expect(html).toContain("Sending");
    expect(render(pendingReply("sending"))).toBe("");
  });

  // TEST_SCENARIO: a fast send is confirmed in milliseconds. The line fades in only after a second, so a fast send never flashes "Sending" before the working dots.
  test("shows the words only after a delay", () => {
    const html = render({ ...sent, unconfirmed: "sending" });
    expect(html).toContain("anim-in-late");
  });

  // TEST_SCENARIO: the send woke an agent stopped for idleness, which takes up to a couple of minutes. The person's message says the agent is starting, which is what they wait for.
  test("says Starting the agent when the send woke it", () => {
    const html = render({ ...sent, unconfirmed: "waking" });
    expect(html).toContain("Starting the agent");
    expect(html).not.toContain('data-testid="working-dots"');
  });

  // TEST_SCENARIO: a message marked Not delivered says why; it is no longer on its way.
  test("a failed send says nothing about sending", () => {
    const html = render({
      ...sent,
      unconfirmed: "sending",
      error: { message: "Not delivered — no answer" },
    });
    expect(html).not.toContain('data-testid="send-unconfirmed"');
  });

  // TEST_SCENARIO: a confirmed reply is the agent's own work, so it shows the working dots as before.
  test("shows the working dots once confirmed", () => {
    const html = render(pendingReply());
    expect(html).toContain('data-testid="working-dots"');
  });

  // TEST_SCENARIO: the session row in the sidebar and the chat read one fact. Before the runtime accepts the message the session is not working, so its row shows no working dots; once accepted, it does.
  test("the session does not count as working until confirmed", () => {
    expect(hasWorkingReply([sent, pendingReply("sending")])).toBe(false);
    expect(hasWorkingReply([sent, pendingReply()])).toBe(true);
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

  // TEST_SCENARIO: the person's message carries the same mark under its prompt id, and the confirmation clears it there too.
  test("the person's message is confirmed with its reply", () => {
    const out = applyUpdate(
      [{ ...sent, id: "p1", unconfirmed: "sending" }, pendingReply("sending")],
      {
        sessionUpdate: "platform_prompt_accepted",
        sessionId: "s1",
        promptId: "p1",
        queued: false,
      },
    );
    expect(out.map((m) => m.unconfirmed)).toEqual([undefined, undefined]);
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
