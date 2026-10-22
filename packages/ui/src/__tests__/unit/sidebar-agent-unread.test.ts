// TEST_OVERVIEW: An Agent row is marked unread when any Session the UI knows of is unread: a row of the attention record, or a row of the Agent's own list already loaded, which reaches past the record's limit. The Session the user has open counts as read.
import type { QueryClient } from "@tanstack/react-query";
import { SESSION_CATEGORIES } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ current: null as QueryClient | null }));
vi.mock("../../query-client.js", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  client.current = new QueryClient();
  return { queryClient: client.current };
});
vi.mock("../../store.js", () => ({ useStore: { getState: () => ({}) } }));
vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../../modules/agents/agent-trpc.js", () => ({ agentTrpc: vi.fn() }));

const { acpSessionsKeys } = await import("../../modules/sessions/api/keys.js");
const { useAgentsWithUnreadListedSessions } =
  await import("../../modules/sessions/api/queries.js");

const session = (agentId: string, sessionId: string, unread: boolean) => ({
  agentId,
  sessionId,
  updatedAt: "2026-10-20T10:00:00Z",
  seenAt: unread ? "2026-10-20T09:00:00Z" : "2026-10-20T10:00:00Z",
});

function unreadAgents(openSessionId: string | null): string[] {
  let ids: ReadonlySet<string> = new Set();
  renderToStaticMarkup(
    createElement(() => {
      ids = useAgentsWithUnreadListedSessions(openSessionId);
      return null;
    }),
  );
  return [...ids].sort();
}

it("TEST_SCENARIO: an unread Session on a later page of an Agent's own list marks that Agent, and a read list does not", () => {
  client.current!.setQueryData(
    acpSessionsKeys.pagesOf("a", SESSION_CATEGORIES),
    {
      pages: [
        { sessions: [session("a", "a1", false)], nextCursor: "c" },
        { sessions: [session("a", "a2", true)], nextCursor: null },
      ],
      pageParams: [null, "c"],
    },
  );
  client.current!.setQueryData(
    acpSessionsKeys.pagesOf("b", SESSION_CATEGORIES),
    {
      pages: [{ sessions: [session("b", "b1", false)], nextCursor: null }],
      pageParams: [null],
    },
  );
  expect(unreadAgents(null)).toEqual(["a"]);
  expect(unreadAgents("a2")).toEqual([]);
});
