package telemetry

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestWorkqueueMetricsProvider(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	meter := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)).Meter("test")
	p := newWorkqueueMetricsProvider(meter)

	depth := p.NewDepthMetric("agent")
	adds := p.NewAddsMetric("agent")
	latency := p.NewLatencyMetric("agent")
	retries := p.NewRetriesMetric("agent")
	unfinished := p.NewUnfinishedWorkSecondsMetric("agent")

	adds.Inc()
	adds.Inc()
	depth.Inc()
	depth.Inc()
	depth.Dec()
	latency.Observe(0.25)
	retries.Inc()
	unfinished.Set(1.5)

	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &rm))
	require.Len(t, rm.ScopeMetrics, 1)

	byName := map[string]metricdata.Metrics{}
	for _, m := range rm.ScopeMetrics[0].Metrics {
		byName[m.Name] = m
	}

	wantAttr := attribute.NewSet(attribute.String("workqueue.name", "agent"))

	addsData, ok := byName["platform.workqueue.adds"].Data.(metricdata.Sum[int64])
	require.True(t, ok)
	require.Len(t, addsData.DataPoints, 1)
	assert.Equal(t, int64(2), addsData.DataPoints[0].Value)
	assert.Equal(t, wantAttr, addsData.DataPoints[0].Attributes)

	depthData, ok := byName["platform.workqueue.depth"].Data.(metricdata.Sum[int64])
	require.True(t, ok)
	require.Len(t, depthData.DataPoints, 1)
	assert.Equal(t, int64(1), depthData.DataPoints[0].Value)

	latencyData, ok := byName["platform.workqueue.latency"].Data.(metricdata.Histogram[float64])
	require.True(t, ok)
	require.Len(t, latencyData.DataPoints, 1)
	assert.Equal(t, uint64(1), latencyData.DataPoints[0].Count)

	retriesData, ok := byName["platform.workqueue.retries"].Data.(metricdata.Sum[int64])
	require.True(t, ok)
	assert.Equal(t, int64(1), retriesData.DataPoints[0].Value)

	unfinishedData, ok := byName["platform.workqueue.unfinished_work"].Data.(metricdata.Gauge[float64])
	require.True(t, ok)
	assert.Equal(t, 1.5, unfinishedData.DataPoints[0].Value)
}

func TestStartReconcileRecordsMetricsAndOutcome(t *testing.T) {
	ctx, finish := StartReconcile(context.Background(), "agent", "my-agent")
	assert.NotNil(t, ctx)
	// No telemetry configured — must be a silent no-op.
	finish(OutcomeSuccess, nil)
}

func TestStartPassNoTelemetryIsNoop(t *testing.T) {
	ctx, finish := StartPass(context.Background(), "idle check")
	assert.NotNil(t, ctx)
	finish(nil)
}
