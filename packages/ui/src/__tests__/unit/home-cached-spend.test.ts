// TEST_OVERVIEW: The Home spend widget shows the newest cached breakdown for its period and time zone while a fresh window loads, never one for another period, zone or agent.
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

it("picks the newest same-period entry and ignores the rest", () => {
  const queryClient = new QueryClient();
  const seed = (
    input: { from: string; to: string; timeZone: string; agentId?: string },
    costUsd: number,
    at: number,
  ) =>
    queryClient.setQueryData(
      trpc.metrics.spendBreakdown.queryKey(input),
      breakdown(costUsd) as never,
      { updatedAt: at },
    );
  const week = (iso: string) => spendRange("1w", new Date(iso));
  seed({ ...week("2026-10-01T10:00:00.000Z"), timeZone: zone }, 1, 1);
  seed({ ...week("2026-10-01T10:00:30.000Z"), timeZone: zone }, 2, 2);
  seed({ ...spendRange("1m", new Date()), timeZone: zone }, 3, 3);
  seed({ ...week("2026-10-01T10:01:00.000Z"), timeZone: "UTC" }, 4, 4);
  seed(
    { ...week("2026-10-01T10:01:30.000Z"), timeZone: zone, agentId: "a" },
    5,
    5,
  );

  expect(cachedSpend(queryClient, "1w", zone)).toEqual(breakdown(2));
  expect(cachedSpend(queryClient, "1d", zone)).toBeUndefined();
});
