// TEST_OVERVIEW: The new sidebar's Session list of one Agent loads its next page when the end of the list scrolls into view. The activity filter applies to the loaded pages only, so with a filter on the end of the list stays in view and would load page after page, every Session the Agent has. With a filter on, the list loads no page by itself: it shows a Load more button instead. When the filter is removed, every Agent's Session list keeps its first page only, so the sidebar does not render every Session the filter made it load.
import type { QueryClient } from "@tanstack/react-query";
import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ActivityFilters,
  defaultActivityFilters,
} from "../../modules/home/lib/activity-filter.js";
import type { SidebarSlice } from "../../modules/platform/store/sidebar.js";

const h = vi.hoisted(() => ({
  client: null as QueryClient | null,
  filters: null as unknown,
  list: {
    sessions: [] as SessionView[],
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPageFailed: false,
  },
}));

vi.mock("../../query-client.js", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  h.client = new QueryClient();
  return { queryClient: h.client };
});
vi.mock("../../store.js", () => ({
  useStore: Object.assign(
    (select: (s: Record<string, unknown>) => unknown) =>
      select({ sidebarActivityFilters: h.filters }),
    { getState: () => ({}) },
  ),
}));
vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../../modules/agents/agent-trpc.js", () => ({ agentTrpc: vi.fn() }));
vi.mock("../../modules/sessions/hooks/use-agent-session-list.js", () => ({
  useAgentSessionList: () => ({
    ...h.list,
    rowState: () => ({
      active: false,
      working: false,
      needsApproval: false,
      unread: false,
      draft: false,
    }),
    operable: true,
    answerable: true,
    loading: false,
    failed: false,
    provisional: false,
    recordRead: true,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock(
  "../../modules/platform/components/sidebar-v2/tree-session-row.js",
  () => ({
    TreeSessionRow: ({ session }: { session: SessionView }) =>
      createElement("div", { "data-testid": "session-row" }, session.sessionId),
  }),
);
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentRunState: () => "running",
}));
vi.mock("../../modules/sessions/lib/pinned-sessions.js", () => ({
  pinKey: (agentId: string, sessionId: string) => `${agentId}:${sessionId}`,
  usePinnedSessions: () => new Set(),
}));

const { AgentSessionList } =
  await import("../../modules/platform/components/sidebar-v2/agent-session-list.js");
const { createSidebarSlice } =
  await import("../../modules/platform/store/sidebar.js");
const { acpSessionsKeys } = await import("../../modules/sessions/api/keys.js");

function session(sessionId: string, type: SessionType): SessionView {
  return {
    sessionId,
    agentId: "a-1",
    type,
    mode: SessionMode.Chat,
    createdAt: "2026-10-20T08:00:00Z",
    scheduleId: null,
    title: null,
    updatedAt: null,
  };
}

const slackOnly: ActivityFilters = {
  ...defaultActivityFilters(),
  channelTypes: new Set(["slack"]),
};

function render() {
  return renderToStaticMarkup(
    createElement(AgentSessionList, { agentId: "a-1" }),
  );
}

describe("an agent's session list with a filter on", () => {
  beforeEach(() => {
    h.list = {
      sessions: [
        session("s1", SessionType.Regular),
        session("s2", SessionType.Regular),
      ],
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPageFailed: false,
    };
  });

  it("TEST_SCENARIO: with no filter, the end of the list loads the next page when it scrolls into view", () => {
    h.filters = defaultActivityFilters();
    const html = render();
    expect(html).toContain('data-testid="sidebar-agent-sessions-end"');
    expect(html).not.toContain("sidebar-agent-sessions-load-more");
  });

  it("TEST_SCENARIO: a filter that hides every loaded Session loads no page by itself, and offers Load more", () => {
    h.filters = slackOnly;
    const html = render();
    expect(html).not.toContain("session-row");
    expect(html).not.toContain('data-testid="sidebar-agent-sessions-end"');
    expect(html).toContain('data-testid="sidebar-agent-sessions-load-more"');
    expect(html).toContain("No loaded sessions match the filter.");
  });

  it("TEST_SCENARIO: with a filter on and every page loaded, the list offers no Load more", () => {
    h.filters = slackOnly;
    h.list.hasNextPage = false;
    const html = render();
    expect(html).not.toContain("sidebar-agent-sessions-load-more");
    expect(html).toContain("No sessions match the filter.");
  });

  it("TEST_SCENARIO: while a page loads, Load more stays in place, so keyboard focus stays on it, and says it is loading without loading a second time", () => {
    h.filters = slackOnly;
    h.list.isFetchingNextPage = true;
    const html = render();
    expect(html).toContain('data-testid="sidebar-agent-sessions-load-more"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading…");
  });

  it("TEST_SCENARIO: a page that failed to load offers Retry in place of Load more", () => {
    h.filters = slackOnly;
    h.list.fetchNextPageFailed = true;
    const html = render();
    expect(html).not.toContain("sidebar-agent-sessions-load-more");
    expect(html).toContain('data-testid="sidebar-agent-sessions-more-failed"');
  });
});

describe("removing the filter", () => {
  type Pages = {
    pages: { sessions: SessionView[]; nextCursor: string | null }[];
    pageParams: (string | null)[];
  };
  const loaded = (n: number): Pages => ({
    pages: Array.from({ length: n }, (_, i) => ({
      sessions: [session(`s${i}`, SessionType.Regular)],
      nextCursor: `c${i + 1}`,
    })),
    pageParams: Array.from({ length: n }, (_, i) => (i ? `c${i}` : null)),
  });

  function slice() {
    let state = {} as SidebarSlice;
    const set = (next: Partial<SidebarSlice>) => {
      state = { ...state, ...next };
    };
    state = createSidebarSlice(set as never, () => state as never, {} as never);
    return {
      setFilters: (f: ActivityFilters) => state.setSidebarActivityFilters(f),
    };
  }

  it("TEST_SCENARIO: every Agent's Session list keeps its first page only, once the filter is removed", () => {
    const client = h.client as QueryClient;
    const keyA = acpSessionsKeys.pagesOf("a-1", ["chats"]);
    const keyB = acpSessionsKeys.pagesOf("a-2", ["chats"]);
    const history = acpSessionsKeys.history("a-1", "s1");
    client.setQueryData(keyA, loaded(40));
    client.setQueryData(keyB, loaded(1));
    client.setQueryData(history, ["line"]);
    const { setFilters } = slice();

    setFilters(slackOnly);
    expect((client.getQueryData(keyA) as Pages).pages).toHaveLength(40);

    setFilters(defaultActivityFilters());
    const trimmed = client.getQueryData(keyA) as Pages;
    expect(trimmed.pages).toHaveLength(1);
    expect(trimmed.pageParams).toEqual([null]);
    expect(trimmed.pages[0]?.sessions.map((s) => s.sessionId)).toEqual(["s0"]);
    expect(client.getQueryData(keyB)).toEqual(loaded(1));
    expect(client.getQueryData(history)).toEqual(["line"]);
  });

  it("TEST_SCENARIO: changing one filter for another keeps what is loaded", () => {
    const client = h.client as QueryClient;
    const key = acpSessionsKeys.pagesOf("a-3", ["chats"]);
    client.setQueryData(key, loaded(3));
    const { setFilters } = slice();
    setFilters(slackOnly);
    setFilters({ ...slackOnly, state: "unread" });
    expect((client.getQueryData(key) as Pages).pages).toHaveLength(3);
  });
});
