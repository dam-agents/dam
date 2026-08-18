/** TEST_OVERVIEW: the turn counter that makes browser and messenger turns
 *  comparable — one OTel series per originating surface, fed from the bus. */
import { metrics } from "@opentelemetry/api";
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
  recordTurn,
  resetTurnMetricsForTest,
} from "../../core/turn-metrics.js";
import { startTurnMetricsSaga } from "../../sagas/turn-metrics.js";

describe("turn metrics", () => {
  let reader: PeriodicExportingMetricReader;
  let meterProvider: MeterProvider;
  let saga: Subscription | null = null;

  beforeEach(() => {
    reader = new PeriodicExportingMetricReader({
      exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      exportIntervalMillis: 3_600_000,
    });
    meterProvider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(meterProvider);
    resetTurnMetricsForTest();
  });

  afterEach(async () => {
    saga?.unsubscribe();
    saga = null;
    await meterProvider.shutdown();
    metrics.disable();
    resetTurnMetricsForTest();
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
    recordTurn("ui");

    expect(await seriesBySurface()).toEqual(new Map([["ui", 1]]));
  });

  /** TEST_SCENARIO: the whole point is comparing surfaces, so each must
   *  accumulate on its own series rather than into one total. */
  it("keeps every surface on its own series", async () => {
    for (const surface of ["ui", "ui", "slack", "telegram", "cli"])
      recordTurn(surface);

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
    saga = startTurnMetricsSaga();

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
    saga = startTurnMetricsSaga();

    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "slack",
      agentId: "agent-1",
      actorSub: null,
      outcome: "failure",
    });

    expect(await seriesBySurface()).toEqual(new Map([["slack", 1]]));
  });

  /** TEST_SCENARIO: telemetry is off by default, so an unregistered meter
   *  provider must be a no-op rather than break a turn. */
  it("is a no-op when no meter provider is registered", async () => {
    await meterProvider.shutdown();
    metrics.disable();
    resetTurnMetricsForTest();

    expect(() => recordTurn("ui")).not.toThrow();
  });
});
