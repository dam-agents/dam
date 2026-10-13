// TEST_OVERVIEW: Right after session/new, the session's own view is not loaded yet. The UI seeds it with the pair it sent, so the composer labels the new session with that pair and never falls back to "Configure defaults" in between.
import { QueryClient } from "@tanstack/react-query";
import type { SessionView } from "api-server-api";
import { expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ current: null as QueryClient | null }));
vi.mock("../../query-client.js", () => ({
  get queryClient() {
    return (client.current ??= new QueryClient());
  },
}));
vi.mock("../../store.js", () => ({ useStore: { getState: () => ({}) } }));
vi.mock("../../trpc.js", () => ({ trpc: {} }));
vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../../modules/agents/agent-trpc.js", () => ({ agentTrpc: vi.fn() }));

const { seedStartedSession } =
  await import("../../modules/sessions/api/queries.js");
const { acpSessionsKeys } = await import("../../modules/sessions/api/keys.js");
const view = (sessionId: string) =>
  client.current!.getQueryData<SessionView | null>(
    acpSessionsKeys.session("agent", sessionId),
  );

it("seeds a started session's view with the pair it was started on", () => {
  seedStartedSession("agent", "s1", {
    harness: "claude-code",
    provider: "ibm",
    model: null,
    settings: { mode: "plan" },
  });
  expect(view("s1")).toMatchObject({
    sessionId: "s1",
    agentId: "agent",
    harness: "claude-code",
    provider: "ibm",
    model: null,
    settings: { mode: "plan" },
  });
});

it("keeps a view the server already returned", () => {
  client.current!.setQueryData(acpSessionsKeys.session("agent", "s2"), {
    sessionId: "s2",
    harness: "pi",
  });
  seedStartedSession("agent", "s2", {
    harness: "claude-code",
    provider: "ibm",
    model: null,
  });
  expect(view("s2")?.harness).toBe("pi");
});
