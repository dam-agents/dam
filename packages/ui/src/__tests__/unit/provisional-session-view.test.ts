// TEST_OVERVIEW: While an agent cannot answer for its sessions, the sidebar shows the attention record's last capture of them, as session rows: the last genuine activity orders them and whether a turn ran shows as working.
import { SessionMode, SessionType } from "api-server-api";
import { expect, it, vi } from "vitest";

vi.mock("../../query-client.js", () => ({ queryClient: {} }));
vi.mock("../../store.js", () => ({ useStore: { getState: () => ({}) } }));
vi.mock("../../trpc.js", () => ({ trpc: {} }));
vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../../modules/agents/agent-trpc.js", () => ({ agentTrpc: vi.fn() }));

const { provisionalSessionView } =
  await import("../../modules/sessions/api/queries.js");

it("maps a captured session to a session row", () => {
  expect(
    provisionalSessionView({
      agentId: "agent-a",
      sessionId: "s1",
      mode: SessionMode.Chat,
      type: SessionType.ScheduleCron,
      title: "Nightly report",
      scheduleId: "sch-1",
      createdAt: "2026-10-01T10:00:00.000Z",
      activityAt: "2026-10-02T10:00:00.000Z",
      seenAt: "2026-10-02T09:00:00.000Z",
      working: false,
    }),
  ).toEqual({
    sessionId: "s1",
    agentId: "agent-a",
    type: SessionType.ScheduleCron,
    mode: SessionMode.Chat,
    createdAt: "2026-10-01T10:00:00.000Z",
    scheduleId: "sch-1",
    title: "Nightly report",
    updatedAt: "2026-10-02T10:00:00.000Z",
    running: false,
    seenAt: "2026-10-02T09:00:00.000Z",
  });
});
