import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import {
  createDisabledTimelineService,
  createTimelineService,
  ownedTimelineScope,
  type TimelineReader,
} from "../../modules/timeline/index.js";

/**
 * TEST_OVERVIEW: ownership resolves above the store, so the reader is a spy
 * that records the allowlist it was handed and never a real query.
 */

function spyReader(over: Partial<TimelineReader> = {}) {
  const seen: { ids: readonly string[] }[] = [];
  const reader: TimelineReader = {
    traceShapes: async (ids) => {
      seen.push({ ids });
      return [];
    },
    logTraceShapes: async (ids) => {
      seen.push({ ids });
      return [];
    },
    spendByTrace: async (ids) => {
      seen.push({ ids });
      return [];
    },
    spansForTrace: async (ids) => {
      seen.push({ ids });
      return [];
    },
    logRecords: async (ids) => {
      seen.push({ ids });
      return [];
    },
    ...over,
  };
  return { reader, seen };
}

const owned = [
  { id: "a1", name: "one" },
  { id: "a2", name: null },
];

describe("ownedTimelineScope", () => {
  it("spans every owned agent when none is named", () => {
    expect(ownedTimelineScope(owned, undefined)).toEqual(["a1", "a2"]);
  });

  it("narrows to the named agent when it is owned", () => {
    expect(ownedTimelineScope(owned, "a2")).toEqual(["a2"]);
  });

  it("yields an empty allowlist for an agent the caller does not own", () => {
    expect(ownedTimelineScope(owned, "someone-else")).toEqual([]);
  });
});

describe("createTimelineService", () => {
  it("hands the reader only the resolved allowlist", async () => {
    const { reader, seen } = spyReader();
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    await service.traces({ sinceHours: 24, limit: 100 });

    expect(seen[0]?.ids).toEqual(["a1", "a2"]);
  });

  it("returns nothing, and never queries, for an unowned agent", async () => {
    // TEST_SCENARIO: naming another user's agent must not reach the store.
    const { reader, seen } = spyReader();
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.traces({
      agentId: "not-mine",
      sinceHours: 24,
      limit: 100,
    });

    expect(result).toEqual({ available: true, traces: [], truncated: false });
    expect(seen).toHaveLength(0);
  });

  it("reports a trace with no owned rows as not found", async () => {
    /**
     * TEST_SCENARIO: an empty owner-gated read is indistinguishable from a
     * trace that does not exist, and must not confirm which.
     */
    const { reader } = spyReader();
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    await expect(
      service.trace({
        traceId: "abc123",
        sinceHours: 24,
        spanLimit: 100,
        logLimit: 100,
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("builds a trace from log records alone when no spans exist", async () => {
    /**
     * TEST_SCENARIO: a harness that exports no spans still has a readable
     * trace, which is why the unit is the TraceId across both tables.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        {
          at: "2026-09-14T10:00:00.000Z",
          spanId: "",
          traceId: "abc123",
          event: "claude_code.api_request",
          severity: "INFO",
          service: "nous",
          agentId: "a1",
          invocationId: null,
          attributes: {},
        },
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.trace({
      traceId: "abc123",
      sinceHours: 24,
      spanLimit: 100,
      logLimit: 100,
    });

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.trace.spans).toHaveLength(0);
      expect(result.trace.logs).toHaveLength(1);
      expect(result.trace.logs[0]?.attachedBy).toBe("trace-root");
    }
  });

  it("flags truncation when the row cap is reached", async () => {
    const { reader } = spyReader({
      traceShapes: async () => [
        {
          traceId: "t1",
          startedAt: "2026-09-14T10:00:00.000Z",
          endedAt: "2026-09-14T10:00:01.000Z",
          durationMs: 1000,
          rootName: "claude_code.interaction",
          spanCount: 3,
          errorCount: 0,
          services: ["nous"],
          sessionIds: ["s1"],
          recordCount: 0,
        },
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.traces({ sinceHours: 24, limit: 1 });

    expect(result.available && result.truncated).toBe(true);
  });
});

describe("createDisabledTimelineService", () => {
  it("answers unavailable as a value rather than throwing", async () => {
    /**
     * TEST_SCENARIO: unlike spend, an empty timeline misreports nothing, so
     * the caller is told the backend is off instead of getting an error.
     */
    const service = createDisabledTimelineService();

    const result = await service.traces({ sinceHours: 24, limit: 10 });

    expect(result.available).toBe(false);
  });
});

describe("traces across both tables", () => {
  const shape = (over: Record<string, unknown>) => ({
    traceId: "t1",
    startedAt: "2026-09-14T11:39:25.000Z",
    endedAt: "2026-09-14T11:39:26.000Z",
    durationMs: 0,
    rootName: "claude_code.llm_request",
    spanCount: 1,
    errorCount: 0,
    services: ["claude-code"],
    sessionIds: ["s1"],
    recordCount: 0,
    ...over,
  });

  it("lists a trace that has log records but no spans", async () => {
    /**
     * TEST_SCENARIO: the harness emits a span for only some calls, so a trace
     * known solely to the log table must still appear — the listing used to
     * read the span table alone and dropped it.
     */
    const { reader } = spyReader({
      traceShapes: async () => [],
      logTraceShapes: async () => [
        shape({
          traceId: "logs-only",
          rootName: "claude_code.api_request",
          spanCount: 0,
          recordCount: 2,
        }),
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.traces({ sinceHours: 24, limit: 100 });

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.traces.map((t) => t.traceId)).toEqual(["logs-only"]);
      expect(result.traces[0]?.spanCount).toBe(0);
      expect(result.traces[0]?.recordCount).toBe(2);
    }
  });

  it("shows a trace once when both tables know it, keeping the span shape", async () => {
    const { reader } = spyReader({
      traceShapes: async () => [shape({ traceId: "both", spanCount: 1 })],
      logTraceShapes: async () => [
        shape({
          traceId: "both",
          rootName: "claude_code.api_request",
          spanCount: 0,
          recordCount: 3,
          startedAt: "2026-09-14T11:39:24.000Z",
        }),
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.traces({ sinceHours: 24, limit: 100 });

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.traces).toHaveLength(1);
      expect(result.traces[0]?.rootName).toBe("claude_code.llm_request");
      expect(result.traces[0]?.spanCount).toBe(1);
      expect(result.traces[0]?.startedAt).toBe("2026-09-14T11:39:24.000Z");
    }
  });

  it("orders the merged listing newest first", async () => {
    const { reader } = spyReader({
      traceShapes: async () => [
        shape({ traceId: "older", startedAt: "2026-09-14T11:00:00.000Z" }),
      ],
      logTraceShapes: async () => [
        shape({
          traceId: "newer",
          startedAt: "2026-09-14T12:00:00.000Z",
          endedAt: "2026-09-14T12:00:01.000Z",
          spanCount: 0,
          recordCount: 1,
        }),
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.traces({ sinceHours: 24, limit: 100 });

    expect(result.available && result.traces.map((t) => t.traceId)).toEqual([
      "newer",
      "older",
    ]);
  });
});
