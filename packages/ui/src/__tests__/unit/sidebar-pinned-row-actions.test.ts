// TEST_OVERVIEW: A pinned Session in the new layout's sidebar, and a Session in its flat all-sessions list, keeps the actions and spend it had in its Agent's own list. A row the owner's attention feed supplies renders through the same tree row, so it shows the Session's cost, offers Export telemetry when telemetry is on, and reads history ahead of a click while its Agent can answer.
import { SessionMode, SessionType } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
const env = vi.hoisted(() => ({ telemetry: true, operable: true }));
const cost = vi.hoisted(() => ({ sessionId: "s1", amounts: [] }));

vi.mock("../../query-client.js", () => ({
  queryClient: { setQueryData: vi.fn() },
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      view: "home",
      drafts: {},
      pendingPermissions: [],
      deleteSession: vi.fn(),
      showConfirm: vi.fn(),
    }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useIsAgentOperable: () => env.operable,
  useIsAgentAnswerableSoon: () => env.operable,
}));
vi.mock("../../modules/agents/hooks/use-act-when-awake.js", () => ({
  useActWhenAwake: () => vi.fn(),
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForOwner: () => ({ data: [] }),
}));
vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: { "agent-telemetry": env.telemetry } }),
  useInstallCapabilities: () => ({ data: { telemetryBackend: true } }),
}));
vi.mock("../../modules/sessions/api/background-work.js", () => ({
  useSessionBackgroundWork: () => [],
}));
vi.mock("../../modules/sessions/api/queries.js", async () => {
  const { SessionMode: Mode } = await import("api-server-api");
  return {
    prefetchSessionHistory: vi.fn(),
    useAgentSession: vi.fn(),
    provisionalSessionView: (item: Record<string, unknown>) => ({
      ...item,
      mode: item.mode ?? Mode.Chat,
    }),
  };
});
vi.mock("../../modules/sessions/hooks/use-open-session.js", () => ({
  useOpenSession: () => vi.fn(),
}));
vi.mock("../../modules/sessions/lib/use-session-conversations.js", () => ({
  useSessionConversations: () => () => undefined,
}));
vi.mock("../../modules/spend/api/queries.js", () => ({
  useSessionSpend: () => new Map([["s1", cost]]),
}));
vi.mock("../../modules/telemetry/api/download-export.js", () => ({
  downloadTelemetryExport: vi.fn(),
}));
vi.mock("../../modules/sessions/components/rename-session-dialog.js", () => ({
  RenameSessionDialog: () => null,
}));
vi.mock("../../modules/sessions/components/session-row.js", () => ({
  sessionTitleLabel: (s: { title?: string }) => s.title ?? "",
  SessionRow: (props: Record<string, unknown>) => {
    seen.props.push(props);
    return null;
  },
}));

const { FeedSessionRow } =
  await import("../../modules/platform/components/sidebar-v2/pinned-rows.js");

function renderFeedPin(pinned = true) {
  seen.props.length = 0;
  renderToStaticMarkup(
    createElement(FeedSessionRow, {
      pinned,
      item: {
        id: "a:s1",
        at: "2026-10-20T00:00:00Z",
        working: false,
        unread: false,
        agent: { id: "a", name: "dam", state: "running", avatar: null },
        session: {
          agentId: "a",
          sessionId: "s1",
          mode: SessionMode.Chat,
          type: SessionType.Regular,
          title: "Recent",
          scheduleId: null,
          threadTs: null,
          harness: "claude-code",
          createdAt: "2026-10-20T00:00:00Z",
          activityAt: "2026-10-20T00:00:00Z",
          seenAt: null,
          working: false,
        },
      } as never,
    }),
  );
  return seen.props[0]!;
}

beforeEach(() => {
  env.telemetry = true;
  env.operable = true;
});

// TEST_SCENARIO: pinning a recent Session moves it to a row the feed supplies; that row must still show its spend and offer Export telemetry and the history prefetch, as its Agent's list did.
it("keeps cost, export and prefetch on a feed-sourced pin", () => {
  const props = renderFeedPin();
  expect(props.pinned).toBe(true);
  expect(props.cost).toBe(cost);
  expect(typeof props.onExportTimeline).toBe("function");
  expect(typeof props.onPrefetch).toBe("function");
});

// TEST_SCENARIO: the pinned row gates its actions as the Agent's list does: no export while telemetry is off, and no prefetch while the Agent cannot answer.
it("gates export and prefetch the same way as the Agent's list", () => {
  env.telemetry = false;
  env.operable = false;
  const props = renderFeedPin();
  expect(props.onExportTimeline).toBeUndefined();
  expect(props.onPrefetch).toBeUndefined();
  expect(props.cost).toBe(cost);
});

// TEST_SCENARIO: the Pinned section mixes Sessions of many Agents, so a pinned row leads with its Agent's avatar and the Session's activity dot over it, shows the harness icon in place of the harness name in its context line, not before its title, and keeps the Session's kind icons while its own dot replaces the activity ones. Its pin mark shows only with the row's actions, on hover or keyboard focus.
it("leads a pinned row with its Agent's avatar under the activity dot", () => {
  const props = renderFeedPin();
  const leading = renderToStaticMarkup(props.leading as never);
  expect(leading).toContain("<svg");
  expect(leading).toMatch(
    /<svg[\s\S]*data-testid="session-activity-dot" data-tone="idle"/,
  );
  expect(props.titleIcon).toBeUndefined();
  const context = renderToStaticMarkup(props.conversation as never);
  expect(context).toMatch(
    /^dam · <span[^>]*><span role="img" aria-label="Claude"/,
  );
  expect(context).not.toContain("Claude ·");
  expect(context).toContain("Chat");
  expect(props.activityIndicators).toBe(false);
  expect(props.quietPin).toBe(true);
});

// TEST_SCENARIO: grouped as all sessions, the flat list draws each Session with the same row as the Pinned section, its Agent's avatar and name included, but unpinned, so its action offers to pin it.
it("draws a flat-list row like a pinned row, unpinned", () => {
  const props = renderFeedPin(false);
  expect(props.pinned).toBe(false);
  expect(renderToStaticMarkup(props.conversation as never)).toMatch(/^dam · /);
});
