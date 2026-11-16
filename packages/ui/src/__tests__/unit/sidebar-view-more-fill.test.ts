// @vitest-environment happy-dom
// TEST_OVERVIEW: With a filter on an Agent, each View more fills the next five rows of matching Sessions: the list loads one page after another while its rows fall short and the Agent has more, and stops at five more rows or at the list's end, where it no longer offers View more. One click loads at most five pages, saying it is looking, then offers Keep looking. The list names the filter and offers to clear it, and an open Session the filter would hide is marked as open.
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  list: {} as Record<string, unknown>,
  setFilter: vi.fn(),
  filter: null as unknown,
}));

vi.mock("../../modules/sessions/lib/agent-session-filters.js", async () => {
  const { defaultActivityFilters } =
    await import("../../modules/home/lib/activity-filter.js");
  return {
    useAgentSessionFilter: () =>
      (fake.filter ??= {
        ...defaultActivityFilters(),
        channelTypes: new Set(["chat"]),
      }),
    setAgentSessionFilter: fake.setFilter,
  };
});

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({ deleteSession: () => {}, showConfirm: async () => false }),
}));
vi.mock("../../modules/agents/hooks/use-act-when-awake.js", () => ({
  useActWhenAwake: () => () => {},
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentRunState: () => "running",
}));
vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: {} }),
  useInstallCapabilities: () => ({ data: {} }),
}));
vi.mock("../../modules/sessions/hooks/use-open-session.js", () => ({
  useOpenSession: () => () => {},
}));
vi.mock("../../modules/sessions/api/queries.js", () => ({
  prefetchSessionHistory: () => {},
  provisionalSessionView: (s: unknown) => s,
}));
vi.mock("../../modules/telemetry/api/download-export.js", () => ({
  downloadTelemetryExport: () => {},
}));
vi.mock("../../modules/sessions/components/rename-session-dialog.js", () => ({
  RenameSessionDialog: () => null,
}));
vi.mock("../../modules/sessions/components/session-row.js", () => ({
  SessionRow: ({
    session,
    outsideFilter,
  }: {
    session: { sessionId: string };
    outsideFilter?: boolean;
  }) =>
    createElement(
      "div",
      {
        "data-session-id": session.sessionId,
        "data-outside-filter": outsideFilter ? "true" : undefined,
      },
      createElement("button", { "data-row-main": "" }, session.sessionId),
    ),
}));
vi.mock("../../modules/sessions/hooks/use-agent-session-list.js", () => ({
  useAgentSessionList: () => fake.list,
}));

const { SidebarAgentSessions } =
  await import("../../modules/sessions/components/sidebar-agent-sessions.js");

const session = (n: number) => ({
  agentId: "a-1",
  sessionId: `s${n}`,
  updatedAt: new Date(Date.UTC(2026, 9, 1, 0, 60 - n)).toISOString(),
});
const sessions = (count: number) =>
  Array.from({ length: count }, (_, i) => session(i + 1));

function setList(over: Record<string, unknown>) {
  fake.list = {
    sessions: [],
    rowState: () => ({ active: false }),
    operable: true,
    loading: false,
    provisional: false,
    failed: false,
    retrying: false,
    retry: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPageFailed: false,
    fetchNextPage: async () => {},
    ...over,
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const props = {
  agentId: "a-1",
  open: true,
  preview: [],
  previewComplete: true,
  conversationOf: () => undefined,
};

function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = () =>
    act(() => root.render(createElement(SidebarAgentSessions, props as never)));
  render();
  return render;
}

const shown = () =>
  [...container.querySelectorAll("[data-session-id]")].map((el) =>
    el.getAttribute("data-session-id"),
  );
const viewMore = () =>
  container.querySelector<HTMLButtonElement>(
    "[data-testid='sidebar-agent-sessions-more']",
  );

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  fake.filter = null;
});

// TEST_SCENARIO: the first page brings two matching Sessions and the Agent has more; one View more loads pages until ten rows show, also when a page brings only two, and loads no page once they do.
it("loads pages after View more until the rows fill the next five", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchNextPage = vi.fn(async () => {});
  setList({ sessions: sessions(2), hasNextPage: true, fetchNextPage });
  const render = mount();
  expect(shown()).toEqual(["s1", "s2"]);
  expect(fetchNextPage).not.toHaveBeenCalled();

  await act(async () => viewMore()?.click());
  expect(fetchNextPage).toHaveBeenCalledTimes(1);

  setList({
    sessions: sessions(4),
    hasNextPage: true,
    isFetchingNextPage: true,
    fetchNextPage,
  });
  render();
  setList({ sessions: sessions(4), hasNextPage: true, fetchNextPage });
  render();
  expect(fetchNextPage).toHaveBeenCalledTimes(2);

  setList({ sessions: sessions(12), hasNextPage: true, fetchNextPage });
  render();
  expect(shown()).toHaveLength(10);
  expect(fetchNextPage).toHaveBeenCalledTimes(2);
  expect(viewMore()).not.toBeNull();
});

// TEST_SCENARIO: the list ends before the next five fill; the rows that match show, and View more is no longer offered.
it("stops at the end of the list and offers no View more", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchNextPage = vi.fn(async () => {});
  setList({ sessions: sessions(5), hasNextPage: true, fetchNextPage });
  const render = mount();
  await act(async () => viewMore()?.click());
  expect(fetchNextPage).toHaveBeenCalledTimes(1);

  setList({ sessions: sessions(7), hasNextPage: false, fetchNextPage });
  render();
  expect(shown()).toHaveLength(7);
  expect(fetchNextPage).toHaveBeenCalledTimes(1);
  expect(viewMore()).toBeNull();
});

// TEST_SCENARIO: no Session matches page after page (Needs attention on an Agent with few approvals); one click loads five pages while the button says it is looking, then stops and offers Keep looking, which loads five more.
it("loads at most five pages per click, then offers Keep looking", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchNextPage = vi.fn(async () => {});
  setList({ sessions: [], hasNextPage: true, fetchNextPage });
  const render = mount();
  expect(container.textContent).toContain("None of the latest sessions match.");
  expect(viewMore()?.textContent).toBe("Look further");

  await act(async () => viewMore()?.click());
  expect(viewMore()?.textContent).toContain("Looking for more…");
  for (let page = 1; page < 8; page++) {
    setList({
      sessions: [],
      hasNextPage: true,
      isFetchingNextPage: true,
      fetchNextPage,
    });
    render();
    setList({ sessions: [], hasNextPage: true, fetchNextPage });
    render();
  }
  expect(fetchNextPage).toHaveBeenCalledTimes(5);
  expect(viewMore()?.textContent).toBe("Keep looking");

  await act(async () => viewMore()?.click());
  expect(fetchNextPage).toHaveBeenCalledTimes(6);
});

// TEST_SCENARIO: a filter is on; the list names it and Clear filter sets the Agent's filter back to the default.
it("names the filter and clears it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setList({ sessions: sessions(2) });
  mount();
  expect(
    container.querySelector("[data-testid='sidebar-agent-filter-note']")
      ?.textContent,
  ).toContain("Filtered: Chat");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        "[data-testid='sidebar-agent-filter-clear']",
      )
      ?.click(),
  );
  expect(fake.setFilter).toHaveBeenCalledWith(
    "a-1",
    expect.objectContaining({ state: "any" }),
  );
  expect(fake.setFilter.mock.calls[0]![1].channelTypes.size).toBe(6);
});

// TEST_SCENARIO: the open Session is a Slack thread, which the Chat filter hides; it stays in the list, marked as outside the filter, while matching rows are not marked.
it("keeps the open Session and marks it outside the filter", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const slack = { ...session(9), type: "channel_slack", mode: "chat" };
  setList({
    sessions: [session(1), slack],
    rowState: (s: { sessionId: string }) => ({ active: s.sessionId === "s9" }),
  });
  mount();
  expect(shown()).toEqual(["s1", "s9"]);
  const marked = [
    ...container.querySelectorAll("[data-outside-filter='true']"),
  ].map((el) => el.getAttribute("data-session-id"));
  expect(marked).toEqual(["s9"]);
});

// TEST_SCENARIO: after a View more the user picks another filter; the list starts again at five rows and loads no page by itself, as with no click at all.
it("starts again at five rows when the filter changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchNextPage = vi.fn(async () => {});
  setList({ sessions: sessions(12), hasNextPage: true, fetchNextPage });
  const render = mount();
  await act(async () => viewMore()?.click());
  expect(shown()).toHaveLength(10);

  fake.filter = { channelTypes: new Set(["chat"]), state: "needs-attention" };
  setList({ sessions: [], hasNextPage: true, fetchNextPage });
  render();
  render();
  expect(fetchNextPage).not.toHaveBeenCalled();
  expect(viewMore()?.textContent).toBe("Look further");
});
