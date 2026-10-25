// TEST_OVERVIEW: A Shared Agent's session list, as its sidebar shows it to an Agent Editor. Terminal sessions are hidden from anyone without the terminal permission, so an editor never sees the owner's terminals. Editors have no unread state, so no session reads as unread to them, even one the owner has not seen. The owner's own list keeps both.
import {
  AGENT_PERMISSIONS,
  type AgentPermission,
  SESSION_CATEGORIES,
  SessionMode,
  SessionType,
} from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { useAgentSessionList as UseAgentSessionList } from "../../modules/sessions/hooks/use-agent-session-list.js";

const fake = vi.hoisted(() => ({ agent: null as unknown }));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      sessionId: null,
      pendingResumeSessionId: null,
      busy: false,
      pendingPermissions: [],
      sessionFilter: [...SESSION_CATEGORIES],
      drafts: {},
      restartingAgents: new Map(),
    }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: () => fake.agent,
  useAgentRunState: () => "running",
  useIsAgentAnswerableSoon: () => true,
  useIsAgentOperable: () => true,
}));
vi.mock("../../modules/agents/hooks/use-wake-agent.js", () => ({
  useWakeAgent: () => ({ wake: vi.fn() }),
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForAgent: () => ({ data: [] }),
}));
vi.mock("../../modules/spend/api/queries.js", () => ({
  useSessionSpend: () => new Map(),
}));
vi.mock("../../modules/sessions/api/background-work.js", () => ({
  useAgentBackgroundWork: () => [],
}));
vi.mock("../../modules/sessions/lib/use-session-conversations.js", () => ({
  useSessionConversations: () => () => undefined,
}));
vi.mock("../../modules/sessions/api/queries.js", () => ({
  useSessionPages: () => ({
    sessions: [
      {
        sessionId: "chat-1",
        agentId: "a-1",
        mode: SessionMode.Chat,
        type: SessionType.Regular,
        createdAt: "2026-10-01T10:00:00Z",
        updatedAt: "2026-10-01T12:00:00Z",
        seenAt: "2026-10-01T11:00:00Z",
      },
      {
        sessionId: "term-1",
        agentId: "a-1",
        mode: SessionMode.Terminal,
        type: SessionType.Regular,
        createdAt: "2026-10-01T10:00:00Z",
      },
    ],
    isFetching: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    data: undefined,
    errorUpdatedAt: 0,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useProvisionalSessions: () => undefined,
}));

const { useAgentSessionList } =
  await import("../../modules/sessions/hooks/use-agent-session-list.js");

const OWNER = { role: "owner", editors: ["alex@example.com"] };
const EDITOR = {
  role: "editor",
  ownerEmail: "jordan@example.com",
  editors: ["alex@example.com"],
};
const without = (...left: AgentPermission[]) =>
  AGENT_PERMISSIONS.filter((p) => !left.includes(p));

function list(access: object): ReturnType<typeof UseAgentSessionList> {
  fake.agent = { id: "a-1", access };
  let out: ReturnType<typeof UseAgentSessionList> | undefined;
  renderToStaticMarkup(
    createElement(() => {
      out = useAgentSessionList("a-1");
      return null;
    }),
  );
  return out!;
}

const ids = (out: ReturnType<typeof UseAgentSessionList>) =>
  out.sessions.map((s) => s.sessionId);

describe("a Shared Agent's session list", () => {
  // TEST_SCENARIO: an editor holds no terminal permission, so the owner's terminal session is not in their list, while the chat is.
  it("hides terminal sessions from an editor", () => {
    expect(
      ids(list({ ...EDITOR, permissions: without("terminal", "channels") })),
    ).toEqual(["chat-1"]);
  });

  // TEST_SCENARIO: the owner holds every permission and keeps their terminal sessions.
  it("keeps terminal sessions for the owner", () => {
    expect(ids(list({ ...OWNER, permissions: AGENT_PERMISSIONS }))).toEqual([
      "chat-1",
      "term-1",
    ]);
  });

  // TEST_SCENARIO: a chat updated after the owner last saw it reads as unread to the owner, and never to an editor.
  it("shows the unread mark only to the owner", () => {
    const owner = list({ ...OWNER, permissions: AGENT_PERMISSIONS });
    expect(owner.rowState(owner.sessions[0]!).unread).toBe(true);
    const editor = list({
      ...EDITOR,
      permissions: without("terminal", "channels"),
    });
    expect(editor.rowState(editor.sessions[0]!).unread).toBe(false);
  });
});
