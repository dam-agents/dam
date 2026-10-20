// TEST_OVERVIEW: a live-event hint refetches the active queries it names: an agents or harnessConfig hint refreshes the agent list and the harnessConfig queries of the named agent only, and an attention hint also refreshes the named agent's own session pages and single-Session lookups (a sync, every cached agent's), and a burst of hints for one query family runs at most one refetch after the one in flight, never one per hint.
import { type QueryKey, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

vi.stubGlobal("window", new EventTarget());
vi.mock("../../store.js", () => ({ useStore: {} }));
const { queryClient } = await import("../../query-client.js");
const { trpc } = await import("../../trpc.js");
const { agentsKeys } = await import("../../modules/agents/api/queries.js");
const { invalidateForLiveEvent } =
  await import("../../modules/live-events/invalidation.js");

const unsubscribes: (() => void)[] = [];
afterEach(() => {
  unsubscribes.splice(0).forEach((off) => off());
  queryClient.clear();
});

async function watch(queryKey: QueryKey, queryFn: () => Promise<unknown>) {
  unsubscribes.push(
    new QueryObserver(queryClient, { queryKey, queryFn }).subscribe(() => {}),
  );
  await queryClient.refetchQueries({ queryKey });
}

function counter() {
  let calls = 0;
  return { fn: () => Promise.resolve(++calls), calls: () => calls };
}

// TEST_SCENARIO: an agents hint about agent A must still refresh A's harnessConfig status and the agent list, and must leave agent B's harnessConfig status alone.
it("refreshes the list and only the named agent's harnessConfig", async () => {
  const list = counter();
  const statusA = counter();
  const statusB = counter();
  await watch(agentsKeys.listWithChannels(), list.fn);
  await watch(trpc.harnessConfig.status.queryKey({ agentId: "A" }), statusA.fn);
  await watch(trpc.harnessConfig.status.queryKey({ agentId: "B" }), statusB.fn);

  await invalidateForLiveEvent({ topic: "agents", agentId: "A" });

  expect([list.calls(), statusA.calls(), statusB.calls()]).toEqual([2, 2, 1]);
});

// TEST_SCENARIO: an agent that wakes sends several hints back to back. While the first refetch is in flight, the rest must collapse into one more refetch, and the cache must end with what that last refetch read.
it("collapses a burst of hints into one trailing refetch", async () => {
  let calls = 0;
  const releases: (() => void)[] = [];
  const key = trpc.harnessConfig.status.queryKey({ agentId: "A" });
  await watch(key, () => {
    const n = ++calls;
    return n === 1
      ? Promise.resolve(n)
      : new Promise((resolve) => releases.push(() => resolve(n)));
  });

  const first = invalidateForLiveEvent({
    topic: "harnessConfig",
    agentId: "A",
  });
  for (let i = 0; i < 4; i++)
    void invalidateForLiveEvent({ topic: "harnessConfig", agentId: "A" });
  releases.shift()?.();
  await vi.waitFor(() => expect(releases).toHaveLength(1), { interval: 1 });
  releases.shift()?.();
  await first;

  expect(calls).toBe(3);
  expect(queryClient.getQueryData(key)).toBe(3);
});

// TEST_SCENARIO: an attention hint about agent A, sent for a rename or delete of a Session outside the owner's bounded feed, must refetch A's own session pages and A's single-Session lookups (the sidebar's older pins), and leave agent B's alone; otherwise an open list or an old pin keeps a stale title or a deleted row.
it("refreshes the named agent's session pages and pin lookups on an attention hint", async () => {
  const { acpSessionsKeys } =
    await import("../../modules/sessions/api/keys.js");
  const pagesA = counter();
  const pinA = counter();
  const pagesB = counter();
  await watch(acpSessionsKeys.pagesOf("A", ["chats"]), pagesA.fn);
  await watch(acpSessionsKeys.session("A", "old"), pinA.fn);
  await watch(acpSessionsKeys.pagesOf("B", ["chats"]), pagesB.fn);

  await invalidateForLiveEvent({ topic: "attention", agentId: "A" });

  expect([pagesA.calls(), pinA.calls(), pagesB.calls()]).toEqual([2, 2, 1]);
});

// TEST_SCENARIO: when the owner stream overflows, or a tab subscribes again, the server sends one sync instead of the named hints it dropped. Sync must then refetch every agent's session pages and single-Session lookups that are in the cache, and still leave session histories alone; otherwise a rename or delete lost in the overflow never reaches an open list or an old pin.
it("refreshes cached session pages and pin lookups on sync, not histories", async () => {
  const { acpSessionsKeys } =
    await import("../../modules/sessions/api/keys.js");
  const pagesA = counter();
  const pinB = counter();
  const historyA = counter();
  await watch(acpSessionsKeys.pagesOf("A", ["chats"]), pagesA.fn);
  await watch(acpSessionsKeys.session("B", "old"), pinB.fn);
  await watch(acpSessionsKeys.history("A", "s1"), historyA.fn);

  await invalidateForLiveEvent({ topic: "sync" });

  expect([pagesA.calls(), pinB.calls(), historyA.calls()]).toEqual([2, 2, 1]);
});

// TEST_SCENARIO: the sidebar's Pinned section watches an old pin's lookup only to read its activity time for ordering, beside the pin row's own lookup. With both watching (the ordering one set last, as its effect runs after the row's), a sync or a named hint must still run the row's real lookup and replace the cached Session; an ordering watcher that installs its own empty query function would make every refresh fail with "Missing queryFn".
it("still runs an old pin's lookup while the ordering watcher reads it", async () => {
  const { acpSessionsKeys } =
    await import("../../modules/sessions/api/keys.js");
  const { pinActivityQuery } =
    await import("../../modules/platform/lib/sidebar-tree.js");
  let title = "January notes";
  const lookup = vi.fn(() =>
    Promise.resolve({
      sessionId: "old",
      agentId: "A",
      title,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    }),
  );
  await watch(acpSessionsKeys.session("A", "old"), lookup);
  unsubscribes.push(
    new QueryObserver(queryClient, pinActivityQuery("A", "old")).subscribe(
      () => {},
    ),
  );

  title = "Renamed elsewhere";
  await invalidateForLiveEvent({ topic: "sync" });
  await invalidateForLiveEvent({ topic: "attention", agentId: "A" });

  expect(lookup).toHaveBeenCalledTimes(3);
  const query = queryClient
    .getQueryCache()
    .find({ queryKey: acpSessionsKeys.session("A", "old") });
  expect(query?.state.error).toBeNull();
  expect((query?.state.data as { title: string }).title).toBe(
    "Renamed elsewhere",
  );
});

// TEST_SCENARIO: a sync after a stream overflow repairs every cached agent's lists and pin lookups; with many agents it must not send all those reads at once, so at most a bounded number of query families refetch together.
it("bounds how many families a sync refetches at once", async () => {
  const { acpSessionsKeys } =
    await import("../../modules/sessions/api/keys.js");
  let inFlight = 0;
  let peak = 0;
  const slow = () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    return new Promise<number>((resolve) =>
      setTimeout(() => {
        inFlight--;
        resolve(1);
      }, 1),
    );
  };
  for (let i = 0; i < 30; i++)
    await watch(acpSessionsKeys.pagesOf(`agent-${i}`, ["chats"]), slow);
  peak = 0;

  await invalidateForLiveEvent({ topic: "sync" });

  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(8);
});
