/** TEST_OVERVIEW: the turn counter that makes browser and messenger turns
 *  comparable — one OTel series per originating surface, fed from the bus. */
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import type { Subscription } from "rxjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emit, EventType } from "../../events.js";
import {
  createTurnMetrics,
  toTurnSurface,
  type TurnMetrics,
} from "../../core/turn-metrics.js";
import { startTurnMetricsSaga } from "../../sagas/turn-metrics.js";

describe("turn metrics", () => {
  let reader: PeriodicExportingMetricReader;
  let meterProvider: MeterProvider;
  let turns: TurnMetrics;
  let saga: Subscription | null = null;

  beforeEach(() => {
    reader = new PeriodicExportingMetricReader({
      exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      exportIntervalMillis: 3_600_000,
    });
    meterProvider = new MeterProvider({ readers: [reader] });
    turns = createTurnMetrics(meterProvider.getMeter("test"));
  });

  afterEach(async () => {
    saga?.unsubscribe();
    saga = null;
    await meterProvider.shutdown();
  });

  async function seriesBySurface() {
    const { resourceMetrics } = await reader.collect();
    const metric = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((m) => m.descriptor.name === "platform.turn.total");
    return new Map(
      (metric?.dataPoints ?? []).map((p) => [
        String(p.attributes["platform.turn.surface"]),
        p.value,
      ]),
    );
  }

  /** TEST_SCENARIO: the surface must be the only dimension, and it must be the
   *  attribute key a dashboard groups on. */
  it("counts one turn against its surface", async () => {
    turns.recordTurn("ui");

    expect(await seriesBySurface()).toEqual(new Map([["ui", 1]]));
  });

  /** TEST_SCENARIO: the whole point is comparing surfaces, so each must
   *  accumulate on its own series rather than into one total. */
  it("keeps every surface on its own series", async () => {
    for (const surface of ["ui", "ui", "slack", "telegram", "cli"] as const)
      turns.recordTurn(surface);

    expect(await seriesBySurface()).toEqual(
      new Map([
        ["ui", 2],
        ["slack", 1],
        ["telegram", 1],
        ["cli", 1],
      ]),
    );
  });

  /** TEST_SCENARIO: relay turns carry the surface the upgrade resolved from the
   *  caller's token; channel turns carry their messenger. Both must land on the
   *  same counter or the counts are not comparable. */
  it("counts relay turns and channel turns from the bus", async () => {
    saga = startTurnMetricsSaga(turns);

    emit({
      type: EventType.SessionTurnRelayed,
      agentId: "agent-1",
      actorSub: "user-1",
      surface: "ui",
    });
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "slack",
      agentId: "agent-1",
      actorSub: null,
      outcome: "success",
    });
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "telegram",
      agentId: "agent-1",
      actorSub: null,
      outcome: "failure",
    });

    expect(await seriesBySurface()).toEqual(
      new Map([
        ["ui", 1],
        ["slack", 1],
        ["telegram", 1],
      ]),
    );
  });

  /** TEST_SCENARIO: a failed channel turn is still a turn someone drove, so it
   *  counts — the counter measures what was asked, not what came back. */
  it("counts a failed turn the same as a successful one", async () => {
    saga = startTurnMetricsSaga(turns);

    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "slack",
      agentId: "agent-1",
      actorSub: null,
      outcome: "failure",
    });

    expect(await seriesBySurface()).toEqual(new Map([["slack", 1]]));
  });

  /** TEST_SCENARIO: the events type their surface as a bare string, so an
   *  unrecognized value must fall into a known bucket rather than mint a new
   *  time series per value. */
  it("folds an unrecognized surface into the other bucket", async () => {
    saga = startTurnMetricsSaga(turns);

    emit({
      type: EventType.SessionTurnRelayed,
      agentId: "agent-1",
      actorSub: "user-1",
      surface: "surface-that-does-not-exist",
    });

    expect(await seriesBySurface()).toEqual(new Map([["other", 1]]));
    expect(toTurnSurface("ui")).toBe("ui");
    expect(toTurnSurface("")).toBe("other");
  });
});
