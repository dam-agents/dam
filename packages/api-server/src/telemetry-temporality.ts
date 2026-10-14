import type {
  AggregationTemporality,
  InstrumentType,
  PushMetricExporter,
} from "@opentelemetry/sdk-metrics";

/**
 * UNIT_BOUNDARY_DESCRIPTION: makes a gauge report only the series observed in
 * the current collection. Under cumulative temporality the SDK keeps exporting
 * a series after its callback stops observing it, so a replica that hands a
 * state gauge to another would go on reporting a stale value. A gauge carries
 * no temporality on the wire, so selecting delta for gauges changes nothing a
 * reader sees beyond dropping series nobody observes any more.
 */
export function withGaugeDeltaTemporality(
  exporter: PushMetricExporter,
  sdk: {
    InstrumentType: typeof InstrumentType;
    AggregationTemporality: typeof AggregationTemporality;
  },
): PushMetricExporter {
  const gauges = new Set<InstrumentType>([
    sdk.InstrumentType.GAUGE,
    sdk.InstrumentType.OBSERVABLE_GAUGE,
  ]);
  return {
    export: (metrics, done) => exporter.export(metrics, done),
    forceFlush: () => exporter.forceFlush(),
    shutdown: () => exporter.shutdown(),
    selectAggregation: exporter.selectAggregation?.bind(exporter),
    selectAggregationTemporality: (type) =>
      gauges.has(type)
        ? sdk.AggregationTemporality.DELTA
        : (exporter.selectAggregationTemporality?.(type) ??
          sdk.AggregationTemporality.CUMULATIVE),
  };
}
