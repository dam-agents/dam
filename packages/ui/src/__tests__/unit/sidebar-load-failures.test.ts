// TEST_OVERVIEW: In the new layout's sidebar a failed read is never shown as an answer. An Agent's list whose first page failed offers a retry instead of saying it has no Sessions, and an old pin whose first lookup failed offers a retry instead of vanishing; the pin stays stored either way.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

vi.stubGlobal("window", new EventTarget());

const list = vi.hoisted(() => ({
  failed: true,
  loading: false,
}));
const pin = vi.hoisted(() => ({ isError: true }));

vi.mock("../../store.js", async () => {
  const { defaultActivityFilters } =
    await import("../../modules/home/lib/activity-filter.js");
  const state = {
    view: "home",
    sidebarActivityFilters: defaultActivityFilters(),
  };
  return { useStore: (select: (s: unknown) => unknown) => select(state) };
});
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentRunState: () => "running",
  useIsAgentAnswerableSoon: () => true,
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForOwner: () => ({ data: [] }),
}));
vi.mock("../../modules/sessions/hooks/use-agent-session-list.js", () => ({
  useAgentSessionList: () => ({
    sessions: [],
    rowState: () => ({}),
    operable: true,
    loading: list.loading,
    provisional: false,
    recordRead: true,
    failed: list.failed,
    retry: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPageFailed: false,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock("../../modules/sessions/lib/pinned-sessions.js", () => ({
  pinKey: (a: string, s: string) => `${a}:${s}`,
  usePinnedSessions: () => new Set<string>(),
}));
vi.mock("../../modules/sessions/api/queries.js", () => ({
  provisionalSessionView: vi.fn(),
  useAgentSession: () => ({
    data: undefined,
    isError: pin.isError,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("../../modules/sessions/lib/use-session-conversations.js", () => ({
  useSessionConversations: () => () => undefined,
}));
vi.mock(
  "../../modules/platform/components/sidebar-v2/tree-session-row.js",
  () => ({
    TreeSessionRow: () => null,
  }),
);
vi.mock("../../modules/sessions/components/session-list-skeleton.js", () => ({
  SessionListSkeleton: () => null,
}));

const { AgentSessionList } =
  await import("../../modules/platform/components/sidebar-v2/agent-session-list.js");
const { OffFeedPinnedRow } =
  await import("../../modules/platform/components/sidebar-v2/pinned-rows.js");

beforeEach(() => {
  list.failed = true;
  pin.isError = true;
});

// TEST_SCENARIO: the first page of an awake Agent's list failed after its retries, with nothing cached; the list must offer a retry and must not claim the Agent has no Sessions.
it("offers a retry for a failed list, not an empty one", () => {
  const html = renderToStaticMarkup(
    createElement(AgentSessionList, { agentId: "a" }),
  );
  expect(html).toContain('data-testid="sidebar-agent-sessions-failed"');
  expect(html).toContain("Couldn&#x27;t load sessions. Retry");
  expect(html).not.toContain("No sessions yet.");

  list.failed = false;
  expect(
    renderToStaticMarkup(createElement(AgentSessionList, { agentId: "a" })),
  ).toContain("No sessions yet.");
});

// TEST_SCENARIO: after a reload, an old pin's first lookup failed; the Pinned section must keep a row for it with a retry, under the pin's key, rather than drop it from view.
it("keeps a retry row for a pin whose first lookup failed", () => {
  const agent = { id: "a", name: "dam" } as never;
  const html = renderToStaticMarkup(
    createElement(OffFeedPinnedRow, { agent, sessionId: "old" }),
  );
  expect(html).toContain('data-pin-key="a:old"');
  expect(html).toContain('data-testid="sidebar-pin-failed"');
  expect(html).toContain("dam");

  pin.isError = false;
  expect(
    renderToStaticMarkup(
      createElement(OffFeedPinnedRow, { agent, sessionId: "old" }),
    ),
  ).toBe("");
});
