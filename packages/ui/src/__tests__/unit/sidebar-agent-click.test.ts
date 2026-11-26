// TEST_OVERVIEW: A click on an Agent row narrows the sidebar to that Agent, and the Sessions section lists the Agent's own list, so it always shows something true: its loading placeholder while a hibernated Agent wakes, a Retry when the read fails, and "No sessions yet." only when the Agent answered with none.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useActivitySessions } from "../../modules/home/hooks/use-activity-sessions.js";
import { SidebarAgentSessions } from "../../modules/sessions/components/sidebar-agent-sessions.js";

const fake = vi.hoisted(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  return {
    runState: "running",
    loading: false,
    failed: false,
    attention: {} as Record<string, unknown>,
  };
});

vi.mock("../../store.js", () => {
  const state = { view: "home" };
  return {
    useStore: Object.assign(
      (select: (s: unknown) => unknown) => select(state),
      { getState: () => state },
    ),
  };
});
vi.mock("../../modules/agents/hooks/use-act-when-awake.js", () => ({
  useActWhenAwake: () => () => {},
}));
vi.mock("../../modules/agents/api/queries.js", async (original) => ({
  ...(await original<object>()),
  useAgentRunState: () => fake.runState,
  useAgentsList: () => [],
}));
vi.mock("../../modules/sessions/hooks/use-agent-session-list.js", () => ({
  useAgentSessionList: () => ({
    sessions: [],
    rowState: () => ({}),
    operable: false,
    loading: fake.loading,
    provisional: false,
    failed: fake.failed,
    retrying: false,
    retry: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPageFailed: false,
    fetchNextPage: () => {},
  }),
}));
vi.mock("../../modules/home/api/queries.js", () => ({
  useAttention: () => fake.attention,
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForOwner: () => ({ data: [] }),
}));

function openedAgent() {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(SidebarAgentSessions, {
        agentId: "a-1",
        pinnedHeader: null,
        sessionsHeader: null,
      }),
    ),
  );
}

function previewComplete(attention: Record<string, unknown>): boolean {
  fake.attention = attention;
  let complete: boolean | undefined;
  renderToStaticMarkup(
    createElement(() => {
      complete = useActivitySessions().complete;
      return null;
    }),
  );
  return complete!;
}

describe("the attention record answers for an Agent only once it loaded", () => {
  // TEST_SCENARIO: before the first read of the attention record ends, or after it fails, the record says nothing about an Agent, so the sidebar does not claim the Agent has no Sessions.
  it("is complete only after a successful read shorter than its limit", () => {
    expect(previewComplete({ isPending: true, isSuccess: false })).toBe(false);
    expect(
      previewComplete({ isPending: false, isError: true, isSuccess: false }),
    ).toBe(false);
    expect(
      previewComplete({
        isPending: false,
        isSuccess: true,
        data: {
          items: [],
          dismissed: [],
          defaultModels: [],
          outageAlerts: [],
          costReviews: [],
        },
      }),
    ).toBe(true);
  });
});

describe("a click on an Agent", () => {
  // TEST_SCENARIO: the user clicks an awake Agent with no Sessions; the Sessions section lists the Agent's own list, which says "No sessions yet."
  it("lists the Agent's own list", () => {
    fake.runState = "running";
    fake.loading = false;
    fake.failed = false;
    const out = openedAgent();
    expect(out).toContain('data-testid="sidebar-agent-sessions"');
    expect(out).toContain("No sessions yet.");
  });

  // TEST_SCENARIO: the Agent's own list fails its first read too; the row offers a retry and does not claim the Agent has no Sessions.
  it("offers a retry, not No sessions yet, when the Agent's own list fails", () => {
    fake.runState = "running";
    fake.loading = false;
    fake.failed = true;
    const out = openedAgent();
    expect(out).toContain('data-testid="sidebar-agent-sessions-failed"');
    expect(out).not.toContain("No sessions yet.");
    fake.failed = false;
  });

  // TEST_SCENARIO: the user clicks Retry on a failed read of the Agent's own list; while the retry runs, the row shows the busy Retry alone, not a skeleton beside it.
  it("shows no skeleton beside Retry while a failed read retries", () => {
    fake.runState = "running";
    fake.loading = true;
    fake.failed = true;
    const out = openedAgent();
    expect(out).toContain('data-testid="sidebar-agent-sessions-failed"');
    expect(out).not.toContain("animate-pulse");
    expect(out).toContain('aria-busy="false"');
    fake.loading = false;
    fake.failed = false;
  });

  // TEST_SCENARIO: the Agent is hibernated, so its own list waits for the wake that opening it asks for; the row shows the busy loading placeholder and no note.
  it("shows a hibernated Agent's list as loading while it wakes", () => {
    fake.runState = "hibernated";
    fake.loading = true;
    const out = openedAgent();
    expect(out).toContain("animate-pulse");
    expect(out).toContain('aria-busy="true"');
    expect(out).not.toContain("No sessions yet.");
  });
});
