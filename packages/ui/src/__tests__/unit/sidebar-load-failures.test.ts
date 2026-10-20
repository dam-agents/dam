// TEST_OVERVIEW: In the new layout's sidebar a failed read is never shown as an answer. An Agent's list whose first page failed offers a retry instead of saying it has no Sessions, and an old pin whose first lookup failed offers a retry instead of vanishing; the pin stays stored either way.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

vi.stubGlobal("window", new EventTarget());

const list = vi.hoisted(() => ({
  failed: true,
  loading: false,
  retrying: false,
}));
const pin = vi.hoisted(() => ({
  result: {
    data: undefined as unknown,
    errorUpdatedAt: 1,
    isFetching: false,
    refetch: () => Promise.resolve(),
  },
}));

vi.mock("../../store.js", async () => {
  const { defaultActivityFilters } =
    await import("../../modules/home/lib/activity-filter.js");
  const state = {
    view: "home",
    drafts: {},
    pendingPermissions: [],
    sidebarActivityFilters: defaultActivityFilters(),
  };
  return { useStore: (select: (s: unknown) => unknown) => select(state) };
});
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentRunState: () => "running",
  useIsAgentAnswerableSoon: () => true,
  useIsAgentOperable: () => true,
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
    retrying: list.retrying,
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
  useAgentSession: () => pin.result,
}));
vi.mock("../../modules/sessions/api/background-work.js", () => ({
  useSessionBackgroundWork: () => [],
}));
vi.mock("../../modules/spend/api/queries.js", () => ({
  useSessionSpend: () => new Map(),
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
vi.mock(
  "../../modules/sessions/components/session-list-skeleton.js",
  async () => {
    const { createElement: h } = await import("react");
    return { SessionListSkeleton: () => h("i", { "data-skeleton": "" }) };
  },
);

const { AgentSessionList } =
  await import("../../modules/platform/components/sidebar-v2/agent-session-list.js");
const { OffFeedPinnedRow } =
  await import("../../modules/platform/components/sidebar-v2/pinned-rows.js");

beforeEach(() => {
  list.failed = true;
  list.loading = false;
  list.retrying = false;
  pin.result = {
    data: undefined,
    errorUpdatedAt: 1,
    isFetching: false,
    refetch: () => Promise.resolve(),
  };
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

// TEST_SCENARIO: an Agent that is starting is not operable yet, so its list still counts as loading, but its first page already failed; the list must show the retry alone, not a loading skeleton above it, and must not report itself busy.
it("shows the retry without a skeleton while a starting Agent's list failed", () => {
  list.loading = true;
  const html = renderToStaticMarkup(
    createElement(AgentSessionList, { agentId: "a" }),
  );
  expect(html).toContain('data-testid="sidebar-agent-sessions-failed"');
  expect(html).not.toContain("data-skeleton");
  expect(html).toContain('aria-busy="false"');

  list.failed = false;
  expect(
    renderToStaticMarkup(createElement(AgentSessionList, { agentId: "a" })),
  ).toContain("data-skeleton");
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

  pin.result = { ...pin.result, errorUpdatedAt: 0 };
  expect(
    renderToStaticMarkup(
      createElement(OffFeedPinnedRow, { agent, sessionId: "old" }),
    ),
  ).toBe("");
});

// TEST_SCENARIO: pressing Retry on a failed list starts a refetch; the list's retry control must stay in place, marked busy, while it runs.
it("keeps the list's retry control mounted and busy while it retries", () => {
  list.retrying = true;
  const html = renderToStaticMarkup(
    createElement(AgentSessionList, { agentId: "a" }),
  );
  expect(html).toContain('data-testid="sidebar-agent-sessions-failed"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("Retrying…");
});

// TEST_SCENARIO: an old pin's first lookup failed with nothing cached, and Retry started a second lookup that is still running. React Query then reports the query as pending with no error, so a row keyed on isError would vanish and drop focus; read from a real query in that state, the pin's retry row must stay, busy and inert, and leave once the lookup succeeds.
it("keeps an old pin's retry row through a real pending retry", async () => {
  const { QueryClient, QueryObserver } = await import("@tanstack/react-query");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let release: (value: unknown) => void = () => {};
  let calls = 0;
  const observer = new QueryObserver(client, {
    queryKey: ["pin", "old"],
    queryFn: () =>
      ++calls === 1
        ? Promise.reject(new Error("offline"))
        : new Promise((resolve) => (release = resolve)),
  });
  const off = observer.subscribe(() => {});
  await vi.waitFor(() =>
    expect(observer.getCurrentResult().isError).toBe(true),
  );
  void observer.refetch();
  await vi.waitFor(() =>
    expect(observer.getCurrentResult().isFetching).toBe(true),
  );
  const retrying = observer.getCurrentResult();
  expect(retrying.isError).toBe(false);

  pin.result = retrying as never;
  const agent = { id: "a", name: "dam" } as never;
  const html = renderToStaticMarkup(
    createElement(OffFeedPinnedRow, { agent, sessionId: "old" }),
  );
  expect(html).toContain('data-testid="sidebar-pin-failed"');
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain("Retrying…");

  release({ sessionId: "old" });
  await vi.waitFor(() =>
    expect(observer.getCurrentResult().data).toBeDefined(),
  );
  pin.result = observer.getCurrentResult() as never;
  expect(
    renderToStaticMarkup(
      createElement(OffFeedPinnedRow, { agent, sessionId: "old" }),
    ),
  ).not.toContain("sidebar-pin-failed");
  off();
});
