// @vitest-environment happy-dom
// TEST_OVERVIEW: After View more, keyboard focus moves to the first newly shown Session, also when the new rows arrive late: when a provisional list gives way to the Agent's own list, and when a later page fails and its Retry then loads it.
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  list: {} as Record<string, unknown>,
}));

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
const props = { agentId: "a-1", conversationOf: () => undefined };

function mount(extra: Record<string, unknown>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = () =>
    act(() => root.render(createElement(SidebarAgentSessions, extra as never)));
  render();
  return render;
}

const click = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement).focus();
    (el as HTMLElement).click();
  });
const focusedSession = () =>
  document.activeElement
    ?.closest("[data-session-id]")
    ?.getAttribute("data-session-id");
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  ) ?? null;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// TEST_SCENARIO: an Agent not open in the page previews five Sessions; View more switches to its own list, which shows the five last known Sessions first and the authoritative list later; focus lands on the sixth Session once it shows.
it("focuses the first new Session after a provisional list gives way", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setList({ sessions: sessions(5), provisional: true });
  const preview = sessions(6).map((s) => ({
    id: s.sessionId,
    session: s,
    working: false,
    needsApproval: false,
    unread: false,
  }));
  const render = mount({
    ...props,
    open: false,
    preview,
    previewComplete: false,
  });
  await click(button("View more"));
  render();
  expect(focusedSession()).toBeUndefined();
  setList({ sessions: sessions(10), hasNextPage: true });
  render();
  expect(focusedSession()).toBe("s6");
});

// TEST_SCENARIO: View more needs the next page and that read fails; the user clicks Retry and the page loads; focus lands on the first new Session instead of falling to the page when the Retry button goes away.
it("focuses the first new Session after a Retry loads the failed page", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setList({
    sessions: sessions(5),
    hasNextPage: true,
    fetchNextPage: async () =>
      setList({
        sessions: sessions(5),
        hasNextPage: true,
        fetchNextPageFailed: true,
        fetchNextPage: async () => setList({ sessions: sessions(10) }),
      }),
  });
  const render = mount({
    ...props,
    open: true,
    preview: [],
    previewComplete: true,
  });
  await click(button("View more"));
  render();
  await click(button("Retry"));
  render();
  expect(focusedSession()).toBe("s6");
});
