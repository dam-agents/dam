// TEST_OVERVIEW: Pinning a Session that the owner's attention feed does not hold moves it from its Agent's list to the Pinned section, where it is read by its id. The move must not wait for that read: the pin hands the loaded Session to the lookup, so the Pinned row renders in the same frame and keyboard focus can land on it.
import { QueryClientProvider } from "@tanstack/react-query";
import { SessionMode, SessionType } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.stubGlobal("window", new EventTarget());
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
  clear: () => stored.clear(),
});

const seen = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("../../store.js", async () => {
  const { defaultActivityFilters } =
    await import("../../modules/home/lib/activity-filter.js");
  const state = {
    view: "home",
    drafts: {},
    pendingPermissions: [],
    sidebarActivityFilters: defaultActivityFilters(),
  };
  return {
    useStore: Object.assign(
      (select: (s: unknown) => unknown) => select(state),
      { getState: () => state },
    ),
  };
});
vi.mock("../../modules/agents/api/queries.js", async (original) => ({
  ...(await original<object>()),
  useIsAgentAnswerableSoon: () => false,
  useIsAgentOperable: () => false,
  useAgentLacksLiveUpdates: () => false,
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForOwner: () => ({ data: [] }),
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
  async (original) => ({
    ...(await original<object>()),
    TreeSessionRow: (props: Record<string, unknown>) => {
      seen.rows.push(props);
      return null;
    },
  }),
);

const { queryClient } = await import("../../query-client.js");
const { togglePinKeepingFocus } =
  await import("../../modules/platform/components/sidebar-v2/tree-session-row.js");
const { OffFeedPinnedRow } =
  await import("../../modules/platform/components/sidebar-v2/pinned-rows.js");

vi.stubGlobal("document", { activeElement: null });

const agent = { id: "a", name: "dam" } as never;
const old = {
  sessionId: "old",
  agentId: "a",
  type: SessionType.Regular,
  mode: SessionMode.Chat,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  title: "January notes",
};

function renderPin() {
  seen.rows.length = 0;
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(OffFeedPinnedRow, { agent, sessionId: "old" }),
    ),
  );
  return seen.rows;
}

afterEach(() => {
  queryClient.clear();
  localStorage.clear();
});

// TEST_SCENARIO: without a cached read, an off-feed pin renders nothing while its lookup runs, which is the delay that sent focus to the Agent row; pinning the loaded row from the Agent's list fills that lookup, so the Pinned row renders at once with the loaded Session.
it("renders an old pin at once from the row it was pinned from", () => {
  expect(renderPin()).toHaveLength(0);

  togglePinKeepingFocus("a:old", "a", old);

  const rows = renderPin();
  expect(rows).toHaveLength(1);
  expect(rows[0]!.session).toEqual(old);
  expect(rows[0]!.pinned).toBe(true);
});

// TEST_SCENARIO: unpinning hands nothing to the lookup, so it never writes a Session into the cache for a row that is leaving the Pinned section.
it("seeds the lookup only when pinning", () => {
  togglePinKeepingFocus("a:old", "a");
  togglePinKeepingFocus("a:old", "a", old);
  expect(renderPin()).toHaveLength(0);
});
