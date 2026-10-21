// TEST_OVERVIEW: a live-event hint refetches the active queries it names: an agents or harnessConfig hint refreshes the agent list and the harnessConfig queries of the named agent only, and with the new layout on, an attention hint also refreshes the named agent's own session pages and single-Session lookups (a sync, every cached agent's), and a burst of hints for one query family runs at most one refetch after the one in flight, never one per hint.
import { type QueryKey, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

vi.stubGlobal("window", new EventTarget());
vi.mock("../../store.js", () => ({ useStore: {} }));
const { queryClient } = await import("../../query-client.js");
const { trpc } = await import("../../trpc.js");
const { agentsKeys } = await import("../../modules/agents/api/queries.js");
const { invalidateForLiveEvent } =
  await import("../../modules/live-events/invalidation.js");
const { approvalsKeys } =
  await import("../../modules/approvals/api/queries.js");
const { egressRulesKeys } =
  await import("../../modules/egress-rules/api/queries.js");

const unsubscribes: (() => void)[] = [];
const newLayout = (on: boolean) =>
  queryClient.setQueryData(trpc.features.flags.queryKey(), (flags) => ({
    ...flags!,
    "new-layout": on,
  }));
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

// TEST_SCENARIO: binding presence decides whether an Agent has a default-model notice, and a binding can change in another tab or in Slack or Telegram itself. A schedules hint (a Schedule created or switched on) and an attention hint (a Slack or Telegram binding added or removed) must both refetch the owner's attention query, which carries those notices.
it("refetches the owner's notices on a schedules and an attention hint", async () => {
  const notices = counter();
  await watch(trpc.attention.listForOwner.queryKey(), notices.fn);

  await invalidateForLiveEvent({ topic: "schedules", agentId: "A" });
  expect(notices.calls()).toBe(2);

  await invalidateForLiveEvent({ topic: "attention", agentId: "A" });
  expect(notices.calls()).toBe(3);
});

// TEST_SCENARIO: the live-event stream drops and re-subscribes, and the server answers a new subscription with a sync hint. That hint must refresh every family the stream carries — the agent list, harness config, approvals, egress rules, schedules, budgets, starter-kit updates, knowledge-base shares, artifacts, attention and getting started — because that is how the screen catches up on the events it missed while the connection was down, and no other trigger covers a family the hint forgets.
it("refreshes every live family on a sync hint", async () => {
  const families: Record<string, QueryKey> = {
    "agent list": agentsKeys.listWithChannels(),
    "harness config status": trpc.harnessConfig.status.queryKey({
      agentId: "A",
    }),
    "harness config settled": trpc.harnessConfig.settled.queryKey({
      agentId: "A",
    }),
    "owner approvals": approvalsKeys.forOwner(),
    "agent approvals": approvalsKeys.forAgent("A"),
    "egress rules": egressRulesKeys.forAgent("A"),
    "egress preset": egressRulesKeys.currentPreset("A"),
    "agent schedules": trpc.schedules.list.queryKey({ agentId: "A" }),
    "owner schedules": trpc.schedules.listForOwner.queryKey(),
    "reserved budget": trpc.budgets.reserved.queryKey(),
    "starter-kit updates": trpc.starterKits.updates.queryKey(),
    "knowledge-base share status": trpc.kbShares.status.queryKey({
      agentId: "A",
    }),
    "knowledge-base shares": trpc.kbShares.list.queryKey(),
    "artifact library": trpc.artifactLibrary.list.queryKey({ agentId: "A" }),
    "artifact touches": trpc.artifactLibrary.touches.queryKey({
      agentId: "A",
    }),
    "owner attention": trpc.attention.listForOwner.queryKey(),
    "agent attention": trpc.attention.sessionsForAgent.queryKey({
      agentId: "A",
    }),
    "getting started": trpc.gettingStarted.progress.queryKey(),
  };
  const counters = Object.fromEntries(
    Object.keys(families).map((name) => [name, counter()]),
  );
  for (const [name, key] of Object.entries(families))
    await watch(key, counters[name]!.fn);

  await invalidateForLiveEvent({ topic: "sync" });

  for (const [name, c] of Object.entries(counters))
    expect(c.calls(), `reads of ${name}`).toBeGreaterThanOrEqual(2);
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
  const rest = Array.from({ length: 4 }, () =>
    invalidateForLiveEvent({ topic: "harnessConfig", agentId: "A" }),
  );
  await vi.waitFor(() => expect(releases).toHaveLength(1), { interval: 1 });
  releases.shift()?.();
  await first;
  await vi.waitFor(() => expect(releases).toHaveLength(1), { interval: 1 });
  releases.shift()?.();
  await Promise.all(rest);

  expect(calls).toBe(3);
  expect(queryClient.getQueryData(key)).toBe(3);
});

// TEST_SCENARIO: an attention hint about agent A, sent for a rename or delete of a Session outside the owner's bounded feed, must refetch A's own session pages and A's single-Session lookups (the sidebar's older pins), and leave agent B's alone; otherwise an open list or an old pin keeps a stale title or a deleted row.
it("refreshes the named agent's session pages and pin lookups on an attention hint", async () => {
  newLayout(true);
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
  newLayout(true);
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
  newLayout(true);
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

// TEST_SCENARIO: the live-events stream calls the handler without awaiting it, so several syncs can arrive while the first one's reads are still running. Across all of them at most eight query families refetch at once, and the burst costs one repair pass per family plus at most one trailing pass for those already refetching, not one pass per hint.
it("bounds refetches and trailing passes across overlapping syncs", async () => {
  const { acpSessionsKeys } =
    await import("../../modules/sessions/api/keys.js");
  newLayout(true);
  let inFlight = 0;
  let peak = 0;
  let calls = 0;
  const slow = () => {
    calls++;
    inFlight++;
    peak = Math.max(peak, inFlight);
    return new Promise<number>((resolve) =>
      setTimeout(() => {
        inFlight--;
        resolve(1);
      }, 5),
    );
  };
  for (let i = 0; i < 30; i++)
    await watch(acpSessionsKeys.pagesOf(`agent-${i}`, ["chats"]), slow);
  peak = 0;
  calls = 0;

  const hints = Array.from({ length: 6 }, () =>
    invalidateForLiveEvent({ topic: "sync" }),
  );
  await Promise.all(hints);

  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(8);
  expect(calls).toBeGreaterThanOrEqual(30);
  expect(calls).toBeLessThanOrEqual(30 + 8);
});

// TEST_SCENARIO: with the new layout off, no sidebar tree reads other agents' session pages, so an attention hint must not refetch them; the current layout's open chat keeps its own session watch.
it("leaves session pages alone on an attention hint while the new layout is off", async () => {
  const { acpSessionsKeys } =
    await import("../../modules/sessions/api/keys.js");
  newLayout(false);
  const pagesA = counter();
  await watch(acpSessionsKeys.pagesOf("A", ["chats"]), pagesA.fn);

  await invalidateForLiveEvent({ topic: "attention", agentId: "A" });
  await invalidateForLiveEvent({ topic: "sync" });

  expect(pagesA.calls()).toBe(1);
});

// TEST_SCENARIO: after a reload the sidebar draws the new layout from the preference this browser saved, before the feature flags answer; the first sync and named hints in that window must still refresh the tree's session pages, using the same decision the layout uses.
it("refreshes session pages from the saved layout preference before flags load", async () => {
  const { acpSessionsKeys } =
    await import("../../modules/sessions/api/keys.js");
  const saved = new Map([["platform-new-layout", "1"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => void saved.set(key, value),
    removeItem: (key: string) => void saved.delete(key),
  });
  const pagesA = counter();
  await watch(acpSessionsKeys.pagesOf("A", ["chats"]), pagesA.fn);

  await invalidateForLiveEvent({ topic: "attention", agentId: "A" });
  expect(pagesA.calls()).toBe(2);

  saved.clear();
  await invalidateForLiveEvent({ topic: "attention", agentId: "A" });
  expect(pagesA.calls()).toBe(2);
});

// TEST_SCENARIO: eight expanded lists of starting Agents hold every Session slot, each read waiting until the Agent list says its Agent is running. An agents hint must still refresh the Agent list at once, outside those slots, so the waits end and the held syncs settle without a focus or reconnect refresh.
it("refreshes the agent list while session reads wait for it", async () => {
  const { acpSessionsKeys } =
    await import("../../modules/sessions/api/keys.js");
  newLayout(true);
  let agentReads = 0;
  const waiting: (() => void)[] = [];
  let holding = false;
  const ready = () => !holding || agentReads >= 3;
  await watch(agentsKeys.listWithChannels(), () => {
    agentReads++;
    if (ready()) waiting.splice(0).forEach((go) => go());
    return Promise.resolve(agentReads);
  });
  for (let i = 0; i < 8; i++)
    await watch(acpSessionsKeys.pagesOf(`agent-${i}`, ["chats"]), () =>
      ready()
        ? Promise.resolve(1)
        : new Promise((resolve) => waiting.push(() => resolve(1))),
    );
  holding = true;

  const sync = invalidateForLiveEvent({ topic: "sync" });
  await vi.waitFor(() => expect(waiting).toHaveLength(8));
  await invalidateForLiveEvent({ topic: "agents", agentId: "agent-0" });
  await sync;

  expect(agentReads).toBe(3);
});
