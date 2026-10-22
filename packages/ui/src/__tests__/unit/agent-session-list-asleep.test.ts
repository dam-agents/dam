// TEST_OVERVIEW: An Agent's sidebar session list never waits for ever on an Agent that stays asleep. When the Agent is hibernated, no wake runs and the attention record holds none of its Sessions, because its wake failed or was never allowed (disabled, over its budget), the list reports a failed load whose retry wakes the Agent. While a wake runs, or while the record has not answered, it keeps loading instead.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { useAgentSessionList as UseAgentSessionList } from "../../modules/sessions/hooks/use-agent-session-list.js";

const fake = vi.hoisted(() => ({
  runState: "hibernated",
  restarting: false,
  lastKnown: [] as unknown[] | undefined,
  wake: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      sessionId: null,
      pendingResumeSessionId: null,
      busy: false,
      pendingPermissions: [],
      sessionFilter: [],
      drafts: {},
      restartingAgents: new Map(fake.restarting ? [["a-1", {}]] : []),
    }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentRunState: () => fake.runState,
  useIsAgentAnswerableSoon: () => false,
  useIsAgentOperable: () => false,
}));
vi.mock("../../modules/agents/hooks/use-wake-agent.js", () => ({
  useWakeAgent: () => ({ wake: fake.wake }),
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForAgent: () => ({ data: [] }),
}));
vi.mock("../../modules/spend/api/queries.js", () => ({
  useSessionSpend: () => new Map(),
}));
vi.mock("../../modules/sessions/api/background-work.js", () => ({
  useAgentBackgroundWork: () => [],
}));
vi.mock("../../modules/sessions/lib/use-session-conversations.js", () => ({
  useSessionConversations: () => () => undefined,
}));
vi.mock("../../modules/sessions/api/queries.js", () => ({
  useSessionPages: () => ({
    sessions: undefined,
    isFetching: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    data: undefined,
    errorUpdatedAt: 0,
    fetchNextPage: vi.fn(),
    refetch: fake.refetch,
  }),
  useProvisionalSessions: () => fake.lastKnown,
}));

const { useAgentSessionList } =
  await import("../../modules/sessions/hooks/use-agent-session-list.js");

function list(
  over: Partial<typeof fake>,
): ReturnType<typeof UseAgentSessionList> {
  Object.assign(fake, over);
  let out: ReturnType<typeof UseAgentSessionList> | undefined;
  renderToStaticMarkup(
    createElement(() => {
      out = useAgentSessionList("a-1");
      return null;
    }),
  );
  return out!;
}

describe("a list whose Agent stays asleep", () => {
  // TEST_SCENARIO: the Agent is hibernated, no wake runs and the record holds none of its Sessions; the list fails instead of loading, and its retry asks for a wake, not for the list the Agent cannot answer.
  it("fails, and its retry wakes the Agent", () => {
    const out = list({
      runState: "hibernated",
      restarting: false,
      lastKnown: [],
    });
    expect(out.failed).toBe(true);
    out.retry();
    expect(fake.wake).toHaveBeenCalledExactlyOnceWith("a-1");
    expect(fake.refetch).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a wake runs, from opening the list or the chat, or the Agent is still falling asleep; the list keeps loading, since the Agent will answer or the open will wake it.
  it("keeps loading while a wake runs or the Agent falls asleep", () => {
    expect(list({ runState: "hibernated", restarting: true }).failed).toBe(
      false,
    );
    expect(list({ runState: "hibernating", restarting: false }).failed).toBe(
      false,
    );
  });

  // TEST_SCENARIO: the record has not answered yet, so it may still hold the Agent's Sessions; the list keeps loading.
  it("keeps loading until the record answers", () => {
    const out = list({ runState: "hibernated", lastKnown: undefined });
    expect(out.failed).toBe(false);
    expect(out.loading).toBe(true);
  });
});
