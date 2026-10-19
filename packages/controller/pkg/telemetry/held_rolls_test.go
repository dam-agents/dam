package telemetry

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

// TEST_OVERVIEW: the held-roll metric is an observation of the rolls held right now, not a value written per pass. A hold that ends leaves no series behind — a gauge keeps its last value for the process's life, so an owner whose roll settled would export its last age forever, and owners that churn would fill the SDK's series limit. A hold no pass refreshed stops being observed too, which is what a runner deleted or a template reverted mid-wait looks like.
func TestTheHeldRollGaugeObservesOnlyTheRollsHeldNow(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	meter := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)).Meter("test")
	held := &heldRolls{m: map[string]heldRoll{}}
	_, err := newHeldRollGauge(meter, held)
	require.NoError(t, err)

	now := time.Now()
	held.held("owner-a", now.Add(-90*time.Second))
	held.held("owner-b", now.Add(-10*time.Second))

	ages := func() map[string]int64 {
		var rm metricdata.ResourceMetrics
		require.NoError(t, reader.Collect(context.Background(), &rm))
		got := map[string]int64{}
		for _, scope := range rm.ScopeMetrics {
			for _, m := range scope.Metrics {
				if m.Name != heldRollName {
					continue
				}
				data, ok := m.Data.(metricdata.Gauge[int64])
				require.True(t, ok)
				for _, point := range data.DataPoints {
					owner, _ := point.Attributes.Value("platform.vm_runner.owner")
					got[owner.AsString()] = point.Value
				}
			}
		}
		return got
	}

	got := ages()
	require.Len(t, got, 2, "one series per held roll, and none for an owner never held")
	assert.InDelta(t, 90, got["owner-a"], 5)
	assert.InDelta(t, 10, got["owner-b"], 5)

	held.ended("owner-b")
	got = ages()
	require.Len(t, got, 1, "a hold that ended leaves no series")
	assert.Contains(t, got, "owner-a")

	held.held("owner-c", now)
	held.m["owner-c"] = heldRoll{since: now, seen: now.Add(-heldRollStale - time.Second)}
	got = ages()
	require.Len(t, got, 1, "a hold no pass refreshed stops being observed")
	assert.NotContains(t, got, "owner-c")
	assert.Contains(t, got, "owner-a")
}
