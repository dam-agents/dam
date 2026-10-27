// TEST_OVERVIEW: a schedule's results read the agent's sessions filtered by that schedule, and the UI filters the runtime's answer again; a chat session a one-time task continued names the schedule among the ones that continued it, so it survives both filters, while a session no fire of the schedule touched does not.
import type { Session } from "agent-runtime-api";
import { describe, expect, it, vi } from "vitest";

const list = vi.fn();

vi.mock("../../modules/acp/acp.js", () => ({
  openInitializedConnection: vi.fn(),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  agentLacksLiveUpdates: () => false,
}));
vi.mock("../../modules/agents/agent-trpc.js", () => ({
  agentTrpc: () => ({ sessions: { list: { query: list } } }),
}));

const { listAgentSessionPage } =
  await import("../../modules/sessions/api/acp-session-ops.js");

function session(sessionId: string, extra: Partial<Session> = {}): Session {
  return {
    sessionId,
    mode: "chat",
    type: "regular",
    createdAt: "2026-10-27T09:00:00.000Z",
    updatedAt: "2026-10-27T10:00:00.000Z",
    title: null,
    scheduleId: null,
    threadTs: null,
    seenAt: null,
    runStartedAt: null,
    runTotalMs: null,
    runCount: null,
    running: false,
    ...extra,
  };
}

describe("a schedule's results", () => {
  // TEST_SCENARIO: the runtime answers with the chat the task continued and a chat it did not; the results keep the continued chat only.
  it("keep the chat session a one-time task continued", async () => {
    list.mockResolvedValue({
      sessions: [
        session("continued", { continuedScheduleIds: ["once-1"] }),
        session("other"),
      ],
      nextCursor: null,
    });

    const page = await listAgentSessionPage("agent-1", {
      scheduleId: "once-1",
    });

    expect(page.sessions.map((s) => s.sessionId)).toEqual(["continued"]);
  });
});
