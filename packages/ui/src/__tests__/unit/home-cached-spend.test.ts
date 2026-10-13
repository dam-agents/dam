// TEST_OVERVIEW: The Home spend widget shows the newest breakdown it cached for its period and time zone while a fresh window loads, never one another surface fetched over the same span, such as a Usage month.
import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

vi.mock("../../query-client.js", () => ({ queryClient: new QueryClient() }));
vi.mock("../../store.js", () => ({ useStore: { getState: () => ({}) } }));
vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../../modules/agents/agent-trpc.js", () => ({ agentTrpc: vi.fn() }));

const { trpc } = await import("../../trpc.js");
const { cachedSpend } = await import("../../modules/home/api/queries.js");
const { spendRange } = await import("../../modules/home/lib/spend-period.js");

const zone = "Europe/Prague";
const breakdown = (costUsd: number) => ({
  byModel: [],
  byAgent: [{ costUsd }],
});

it("picks the newest entry Home tagged for the period, ignoring same-span reads", () => {
  const queryClient = new QueryClient();
  const seed = (
    iso: string,
    homeSpend: string | undefined,
    costUsd: number,
  ) => {
    const queryKey = trpc.metrics.spendBreakdown.queryKey({
      ...spendRange("1m", new Date(iso)),
      timeZone: zone,
    });
    queryClient
      .getQueryCache()
      .build(queryClient, { queryKey, meta: homeSpend ? { homeSpend } : {} });
    queryClient.setQueryData(queryKey, breakdown(costUsd) as never, {
      updatedAt: costUsd,
    });
  };
  seed("2026-10-01T10:00:00.000Z", `1m ${zone}`, 1);
  seed("2026-10-01T10:00:30.000Z", `1m ${zone}`, 2);
  seed("2026-10-01T00:00:00.000Z", undefined, 3);
  seed("2026-10-01T10:01:00.000Z", "1m UTC", 4);

  expect(cachedSpend(queryClient, `1m ${zone}`)).toEqual(breakdown(2));
  expect(cachedSpend(queryClient, `1w ${zone}`)).toBeUndefined();
});
