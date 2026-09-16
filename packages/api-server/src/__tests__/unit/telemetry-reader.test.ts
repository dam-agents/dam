import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";

import { createClickhouseTelemetryReader } from "../../modules/telemetry/index.js";

/**
 * TEST_OVERVIEW: a row cap must remove the OLDEST rows of a window, never the
 * newest — the newest turns are the ones beside the reply a reader is looking
 * at. The reader reads newest-first under the cap and hands the rows back in
 * ascending order, so a caller that hits the cap loses history, not the present.
 */

function fakeClient(rows: Record<string, unknown>[]): {
  client: ClickHouseClient;
  queries: string[];
} {
  const queries: string[] = [];
  const client = {
    query: async ({ query }: { query: string }) => {
      queries.push(query);
      return { json: async () => rows };
    },
  } as unknown as ClickHouseClient;
  return { client, queries };
}

const at = (clock: string) => `2026-09-16 ${clock}`;

describe("createClickhouseTelemetryReader ordering", () => {
  it("reads spans newest-first and returns them ascending", async () => {
    /**
     * TEST_SCENARIO: the store answers newest-first, as the DESC order asks —
     * the newest three of a busier window. The reader must present them
     * oldest-to-newest.
     */
    const { client, queries } = fakeClient([
      { spanId: "c", startedAt: at("12:00:03"), durationNs: "0" },
      { spanId: "b", startedAt: at("12:00:02"), durationNs: "0" },
      { spanId: "a", startedAt: at("12:00:01"), durationNs: "0" },
    ]);
    const reader = createClickhouseTelemetryReader(client);

    const spans = await reader.sessionSpans(["a1"], { hours: 24 }, 3);

    expect(queries[0]).toContain("ORDER BY Timestamp DESC");
    expect(spans.map((s) => s.spanId)).toEqual(["a", "b", "c"]);
    expect(spans.map((s) => s.startedAt)).toEqual([
      "2026-09-16T12:00:01Z",
      "2026-09-16T12:00:02Z",
      "2026-09-16T12:00:03Z",
    ]);
  });

  it("reads log records newest-first and returns them ascending", async () => {
    const { client, queries } = fakeClient([
      { at: at("12:00:02"), event: "b" },
      { at: at("12:00:01"), event: "a" },
    ]);
    const reader = createClickhouseTelemetryReader(client);

    const logs = await reader.logRecords(["a1"], { hours: 24 }, 2);

    expect(queries[0]).toContain("ORDER BY Timestamp DESC");
    expect(logs.map((l) => l.event)).toEqual(["a", "b"]);
  });
});
