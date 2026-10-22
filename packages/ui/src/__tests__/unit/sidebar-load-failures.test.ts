// TEST_OVERVIEW: In JanUI's sidebar a failed read is never shown as an answer. An Agent's list whose first page failed offers a retry instead of saying it has no Sessions, and an old pin whose first lookup failed offers a retry instead of vanishing; the pin stays stored either way. An Agent's list ends with its New session row once every page is read and it lists no Session, whether it has none, all are pinned or the filter hides them, and a filter that hid an unpinned one says so.
import { SessionMode, SessionType } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

import {
  defaultActivityFilters,
  onlyChannelType,
} from "../../modules/home/lib/activity-filter.js";

vi.stubGlobal("window", new EventTarget());

const list = vi.hoisted(() => ({
  failed: true,
  loading: false,
  retrying: false,
  nextFailed: false,
}));
const agentState = vi.hoisted(() => ({ answerable: true }));
const rows = vi.hoisted(() => ({
  sessions: [] as unknown[],
  pinned: new Set<string>(),
  filters: undefined as unknown,
}));
const pin = vi.hoisted(() => ({
  result: {
    data: undefined as unknown,
    errorUpdatedAt: 1,
    isFetching: false,
    refetch: () => Promise.resolve(),
  },
}));

vi.mock("../../store.js", () => {
  const state = {
    view: "home",
    drafts: {},
    pendingPermissions: [],
    get sidebarActivityFilters() {
      return rows.filters;
    },
  };
  return { useStore: (select: (s: unknown) => unknown) => select(state) };
});
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentRunState: () => "running",
  useIsAgentAnswerableSoon: () => agentState.answerable,
  useIsAgentOperable: () => true,
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForOwner: () => ({ data: [] }),
}));
vi.mock("../../modules/sessions/hooks/use-agent-session-list.js", () => ({
  useAgentSessionList: () => ({
    sessions: rows.sessions as never[],
    rowState: () => ({}),
    operable: true,
    answerable: agentState.answerable,
    loading: list.loading,
    provisional: false,
    failed: list.failed,
    retrying: list.retrying,
    retry: vi.fn(),
    hasNextPage: list.nextFailed,
    isFetchingNextPage: false,
    fetchNextPageFailed: list.nextFailed,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock("../../modules/sessions/lib/pinned-sessions.js", () => ({
  pinKey: (a: string, s: string) => `${a}:${s}`,
  usePinnedSessions: () => rows.pinned,
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
  list.nextFailed = false;
  agentState.answerable = true;
  rows.sessions = [];
  rows.pinned = new Set();
  rows.filters = defaultActivityFilters();
  pin.result = {
    data: undefined,
    errorUpdatedAt: 1,
    isFetching: false,
    refetch: () => Promise.resolve(),
  };
});

// TEST_SCENARIO: the first page of an awake Agent's list failed after its retries, with nothing cached; the list must offer a retry and must not claim the Agent has no Sessions. Once it loads empty, it shows no empty-state text at all.
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
  ).not.toContain("<p");
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

// TEST_SCENARIO: an old pin's lookup failed and then its Agent went to sleep, which turns the lookup off; a retry could only fail with a missing query function, so the row offers none and the pin shows again once the Agent wakes.
it("offers no retry for a pin whose Agent cannot answer", () => {
  agentState.answerable = false;
  expect(
    renderToStaticMarkup(
      createElement(OffFeedPinnedRow, {
        agent: { id: "a", name: "dam" } as never,
        sessionId: "old",
      }),
    ),
  ).toBe("");
});

// TEST_SCENARIO: a later page of an Agent's list failed; the list keeps its rows and offers a retry for the rest through the same retry control as the first load, which stays mounted while it runs.
it("offers a retry for a failed later page", () => {
  list.failed = false;
  list.nextFailed = true;
  const html = renderToStaticMarkup(
    createElement(AgentSessionList, { agentId: "a" }),
  );
  expect(html).toContain('data-testid="sidebar-agent-sessions-more-failed"');
  expect(html).toContain("Couldn&#x27;t load the rest. Retry");
});

// TEST_SCENARIO: a later page failed and then the Agent went to sleep, which turns its list read off with the first page still cached; the list must neither offer the retry nor load the rest on scroll, since either could only fail with a missing query function, and must offer the retry again once the Agent wakes.
it("offers no later-page retry while the Agent cannot answer", () => {
  list.failed = false;
  list.nextFailed = true;
  agentState.answerable = false;
  const asleep = renderToStaticMarkup(
    createElement(AgentSessionList, { agentId: "a" }),
  );
  expect(asleep).not.toContain("sidebar-agent-sessions-more-failed");
  expect(asleep).not.toContain('class="h-px"');

  agentState.answerable = true;
  expect(
    renderToStaticMarkup(createElement(AgentSessionList, { agentId: "a" })),
  ).toContain('data-testid="sidebar-agent-sessions-more-failed"');
});

// TEST_SCENARIO: an Agent's list always ends with its New session row, whatever it holds or is still fetching, so the row the Agent's own page offers is also the row its list leads to.
it("always ends an Agent's list with its New session row", () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(AgentSessionList, {
        agentId: "a",
        newSessionRow: createElement("i", { "data-new-session": true }),
      }),
    );
  list.failed = true;
  expect(render()).toContain("data-new-session");
  list.failed = false;
  list.loading = true;
  expect(render()).toContain("data-new-session");
  list.loading = false;
  list.nextFailed = true;
  expect(render()).toContain("data-new-session");
  rows.sessions = [
    {
      sessionId: "s1",
      type: SessionType.Regular,
      mode: SessionMode.Chat,
      scheduleId: null,
      createdAt: "2026-10-01T08:00:00Z",
      updatedAt: "2026-10-01T08:00:00Z",
    },
  ];
  expect(render()).toContain("data-new-session");
});

const chat = (sessionId: string) => ({
  sessionId,
  type: SessionType.Regular,
  mode: SessionMode.Chat,
  scheduleId: null,
  createdAt: "2026-10-01T08:00:00Z",
  updatedAt: "2026-10-01T08:00:00Z",
});

// TEST_SCENARIO: an Agent's Sessions are all pinned to the Pinned section above, or the filter hides every one of them; its list under its own row holds no Session either way, and still ends with its New session row. A filter that hid an unpinned Session says so above that row, also when the Sessions it left are all pinned.
it("offers the New session row for a list whose Sessions are all pinned or filtered out", () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(AgentSessionList, {
        agentId: "a",
        newSessionRow: createElement("i", { "data-new-session": true }),
      }),
    );
  list.failed = false;
  rows.sessions = [chat("s1"), chat("s2")];
  expect(render()).toContain("data-new-session");

  rows.pinned = new Set(["a:s1", "a:s2"]);
  const pinned = render();
  expect(pinned).toContain("data-new-session");
  expect(pinned).not.toContain("No sessions match the filter.");

  rows.pinned = new Set();
  rows.filters = onlyChannelType(defaultActivityFilters(), "slack");
  const filtered = render();
  expect(filtered).toContain("No sessions match the filter.");
  expect(filtered).toContain("data-new-session");

  rows.pinned = new Set(["a:s1"]);
  rows.sessions = [
    { ...chat("s1"), type: SessionType.ChannelSlack },
    chat("s2"),
  ];
  const pinnedAndFiltered = render();
  expect(pinnedAndFiltered).toContain("No sessions match the filter.");
  expect(pinnedAndFiltered).toContain("data-new-session");

  rows.filters = defaultActivityFilters();
  expect(render()).not.toContain("No sessions match the filter.");
});
