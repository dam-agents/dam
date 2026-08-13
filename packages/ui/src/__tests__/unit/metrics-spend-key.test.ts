import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "api-server-api";
import { describe, expect, it } from "vitest";

import { keyAgentId } from "../../modules/metrics/lib/spend-key.js";

const trpc = createTRPCOptionsProxy<AppRouter>({
  client: createTRPCClient<AppRouter>({
    links: [httpLink({ url: "/api/trpc" })],
  }),
  queryClient: new QueryClient(),
});

const range = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-09-01T00:00:00.000Z",
  timeZone: "Europe/Prague",
};

describe("keyAgentId", () => {
  it("reads the agent a narrowed read was scoped to", () => {
    const key = trpc.metrics.spendBreakdown.queryKey({
      ...range,
      agentId: "agent-1",
    });
    expect(keyAgentId(key)).toBe("agent-1");
  });

  it("is undefined for an unnarrowed read, matching an unnarrowed caller", () => {
    const key = trpc.metrics.spendBreakdown.queryKey(range);
    expect(keyAgentId(key)).toBeUndefined();
  });

  it("is undefined for anything not shaped like a key", () => {
    expect(keyAgentId(undefined)).toBeUndefined();
    expect(keyAgentId([["metrics", "spendBreakdown"]])).toBeUndefined();
  });
});
