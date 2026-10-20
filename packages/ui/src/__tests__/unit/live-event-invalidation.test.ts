// TEST_OVERVIEW: a live-event hint refetches the active queries it names: an agents or harnessConfig hint refreshes the agent list and the harnessConfig queries of the named agent only, and a burst of hints for one query family runs at most one refetch after the one in flight, never one per hint.
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
afterEach(() => {
  unsubscribes.splice(0).forEach((off) => off());
  queryClient.clear();
});

async function watch(queryKey: QueryKey, queryFn: () => Promise<number>) {
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
  for (let i = 0; i < 4; i++)
    void invalidateForLiveEvent({ topic: "harnessConfig", agentId: "A" });
  releases.shift()?.();
  await vi.waitFor(() => expect(releases).toHaveLength(1), { interval: 1 });
  releases.shift()?.();
  await first;

  expect(calls).toBe(3);
  expect(queryClient.getQueryData(key)).toBe(3);
});
