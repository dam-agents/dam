// TEST_OVERVIEW: an agent opens straight on a new session, and a message sent while the agent starts waits on the same working dots as any reply. What the starting bar used to say about a slow or crashing start shows next to those dots, and only when there is something to say.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  AgentStartNotice,
  hasStartNotice,
} from "../../modules/agents/components/agent-start-notice.js";
import type { AgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
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

vi.mock("../../modules/agents/hooks/use-restart-agent.js", () => ({
  useRestartAgent: () => ({ restart: vi.fn(), isPending: false }),
}));

const starting: AgentDisplay = {
  state: "starting",
  clickable: false,
  powerAction: null,
  slowStart: false,
};

const pendingReply: Message = {
  id: "a1",
  role: "assistant",
  parts: [],
  streaming: true,
};

function renderReply(message: Message, pendingNotice?: string) {
  return renderToStaticMarkup(
    createElement(ChatMessage, {
      message,
      isLast: true,
      hasPendingPermission: false,
      pendingNotice,
      onRetry: vi.fn(),
      onFileClick: vi.fn(),
      onDelete: vi.fn(),
    }),
  );
}

describe("pending reply while the agent starts", () => {
  // TEST_SCENARIO: the reply to a message sent during the start shows the working dots, the same spinner as a reply the agent is thinking about, with the start notice beside it.
  test("waits on the working dots with the notice beside them", () => {
    const html = renderReply(pendingReply, "slow start");
    expect(html).toContain('data-testid="working-dots"');
    expect(html).toContain("slow start");
    expect(html).not.toContain("Sends when the agent is ready");
  });

  // TEST_SCENARIO: once the agent streams its first part, the start is over, so the notice goes away.
  test("drops the notice once the reply has content", () => {
    const html = renderReply(
      { ...pendingReply, parts: [{ kind: "text", text: "hello" }] },
      "slow start",
    );
    expect(html).not.toContain("slow start");
  });
});

describe("start notice", () => {
  // TEST_SCENARIO: a start that runs as usual says nothing, so the new session page carries no loader of its own.
  test("a start on time has no notice", () => {
    expect(hasStartNotice({}, starting)).toBe(false);
  });

  // TEST_SCENARIO: a slow start, or a pod that crashed while it started, is shown with a way to restart the agent.
  test("a slow or crashing start is shown with Restart", () => {
    const slow = {
      ...starting,
      slowStart: true,
      powerAction: "restart" as const,
    };
    expect(hasStartNotice({}, slow)).toBe(true);
    expect(
      hasStartNotice({ podTerminationReason: "OOMKilled" }, starting),
    ).toBe(true);

    const html = renderToStaticMarkup(
      createElement(AgentStartNotice, {
        agent: {
          id: "a",
          notReadyMessage: "pulling image",
        },
        display: slow,
      }),
    );
    expect(html).toContain("Starting is taking longer than usual.");
    expect(html).toContain("pulling image");
    expect(html).toContain("Restart agent");
  });
});
