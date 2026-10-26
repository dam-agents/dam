// TEST_OVERVIEW: a reply's telemetry strip — its duration, calls, tokens and cost — is the reply's own last row, drawn inside the message below everything it shows, so neither the agent's name above it nor the time revealed under the message lies over it, however little the reply holds.
import type { TurnSummary } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ChatMessage } from "../../modules/sessions/components/chat-message.js";
import type { Message } from "../../types.js";

vi.hoisted(() => vi.stubGlobal("window", new EventTarget()));

vi.mock("../../modules/features/hooks/use-unified-right-toolbar.js", () => ({
  useUnifiedRightToolbar: () => false,
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (store: unknown) => unknown) =>
    select({ sessionId: null, pendingPermissions: [] }),
}));

vi.mock("../../modules/telemetry/api/queries.js", () => ({
  useTurn: () => ({ data: undefined, isPending: false, isError: false }),
}));

vi.mock("../../modules/spend/api/queries.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useCallCosts: () => ({ data: undefined }),
}));

const turn: TurnSummary = {
  turnId: "t1",
  promptId: "p1",
  groupedBy: "prompt-id",
  startedAt: "2026-10-16T10:00:00.000Z",
  endedAt: "2026-10-16T10:00:01.800Z",
  durationMs: 1800,
  prompted: true,
  rootName: "turn",
  spanCount: 1,
  recordCount: 1,
  errorCount: 0,
  traceIds: [],
  models: [],
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

const emptyReply: Message = {
  id: "a1",
  role: "assistant",
  parts: [],
  streaming: false,
};

function render(message: Message, withTurn: boolean) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(ChatMessage, {
        message,
        avatarAgent: { name: "Karel", avatar: null },
        isLast: false,
        hasPendingPermission: false,
        timeLabel: "just now",
        timeTitle: "Today 10:00",
        onRetry: vi.fn(),
        onFileClick: vi.fn(),
        onDelete: vi.fn(),
        ...(withTurn ? { turn, agentId: "agent-a", sessionId: "s1" } : {}),
      }),
    ),
  );
}

describe("turn telemetry placement", () => {
  // TEST_SCENARIO: a turn that ended in 1.8 s with nothing to show drew its strip over "Agent · just now" (#5194); the strip is now inside the reply, after its name, and pulls itself up over nothing.
  test("a reply with no content draws its strip below the header, in the message", () => {
    const html = render(emptyReply, true);
    const message = html.indexOf('data-testid="chat-message"');
    const name = html.indexOf("Karel");
    const strip = html.indexOf("1.8s");
    expect(message).toBe(html.lastIndexOf('data-testid="chat-message"'));
    expect(name).toBeGreaterThan(message);
    expect(strip).toBeGreaterThan(name);
    expect(html).not.toMatch(/-mt-\d/);
  });

  // TEST_SCENARIO: the time under a reply is revealed on hover just below the message's box; the strip is inside that box, so the time ("just now") is drawn below the strip, not over it.
  test("the hover-revealed time comes after the strip", () => {
    const html = render(emptyReply, true);
    expect(html.indexOf('data-testid="message-time"')).toBeGreaterThan(
      html.indexOf("1.8s"),
    );
  });

  // TEST_SCENARIO: the strip sits after everything the reply shows, its text included.
  test("the strip follows the reply's text", () => {
    const html = render(
      { ...emptyReply, parts: [{ kind: "text", text: "Done." }] },
      true,
    );
    expect(html.indexOf("1.8s")).toBeGreaterThan(html.indexOf("Done."));
  });

  // TEST_SCENARIO: a reply with no turn matched to it has no strip.
  test("no turn, no strip", () => {
    expect(render(emptyReply, false)).not.toContain("1.8s");
  });
});
