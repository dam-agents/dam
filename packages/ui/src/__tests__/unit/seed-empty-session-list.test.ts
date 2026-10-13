// TEST_OVERVIEW: An agent this tab just created lists no sessions, so its session list starts empty instead of loading. The empty list counts as already stale, so the first read the agent can answer replaces it.
import type { QueryClient } from "@tanstack/react-query";
import { QueryObserver } from "@tanstack/react-query";
import { SESSION_CATEGORIES } from "api-server-api";
import { expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ current: null as QueryClient | null }));
vi.mock("../../query-client.js", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  client.current = new QueryClient();
  return { queryClient: client.current };
});
vi.mock("../../store.js", () => ({ useStore: { getState: () => ({}) } }));
vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../../modules/agents/agent-trpc.js", () => ({ agentTrpc: vi.fn() }));

const { acpSessionsKeys } = await import("../../modules/sessions/api/keys.js");
const { seedEmptySessionList } =
  await import("../../modules/sessions/api/queries.js");

it("lists nothing at once, then reads the agent's real list", async () => {
  const queryClient = client.current as QueryClient;
  const key = acpSessionsKeys.pagesOf("agent-new", SESSION_CATEGORIES);
  seedEmptySessionList("agent-new", SESSION_CATEGORIES);

  expect(queryClient.getQueryData(key)).toEqual({
    pages: [{ sessions: [], nextCursor: null }],
    pageParams: [null],
  });

  const real = { pages: [{ sessions: [{ sessionId: "s1" }] }] };
  const queryFn = vi.fn(async () => real);
  const observer = new QueryObserver(queryClient, {
    queryKey: key,
    queryFn,
    staleTime: 5_000,
  });
  const unsubscribe = observer.subscribe(() => {});
  await vi.waitFor(() => expect(queryClient.getQueryData(key)).toEqual(real));
  expect(queryFn).toHaveBeenCalledOnce();
  unsubscribe();
});
