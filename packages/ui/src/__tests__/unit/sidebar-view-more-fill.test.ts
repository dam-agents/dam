// @vitest-environment happy-dom
// TEST_OVERVIEW: With a filter on an Agent, each View more fills the next five rows of matching Sessions: the list loads one page after another while its rows fall short and the Agent has more, and stops at five more rows or at the list's end, where it no longer offers View more.
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  list: {} as Record<string, unknown>,
}));

vi.mock("../../modules/sessions/lib/agent-session-filters.js", async () => {
  const { defaultActivityFilters } =
    await import("../../modules/home/lib/activity-filter.js");
  return {
    useAgentSessionFilter: () => ({
      ...defaultActivityFilters(),
      channelTypes: new Set(["chat"]),
    }),
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
  SessionRow: ({ session }: { session: { sessionId: string } }) =>
    createElement(
      "div",
      { "data-session-id": session.sessionId },
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
