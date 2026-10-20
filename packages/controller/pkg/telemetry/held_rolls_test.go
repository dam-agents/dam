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

// TEST_OVERVIEW: the held-roll metric is an observation of the rolls held right now, not a value written per pass. A hold that ends leaves no age behind — a gauge keeps its last value for the process's life, so an owner whose roll settled would export its last age forever, and owners that churn would fill the SDK's series limit. A hold no pass refreshed stops being observed too, which is what a runner deleted or a template reverted mid-wait looks like. The series names no owner, since a runner is per owner and no exported series names a person.
func TestTheHeldRollGaugeObservesOnlyWhatIsHeldNow(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	meter := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)).Meter("test")
	held := &heldRolls{m: map[string]heldRoll{}}
	_, err := newHeldRollGauge(meter, held)
	require.NoError(t, err)

	observed := func() []metricdata.DataPoint[int64] {
		var rm metricdata.ResourceMetrics
		require.NoError(t, reader.Collect(context.Background(), &rm))
		for _, scope := range rm.ScopeMetrics {
			for _, m := range scope.Metrics {
				if m.Name != heldRollName {
					continue
				}
				data, ok := m.Data.(metricdata.Gauge[int64])
				require.True(t, ok)
				return data.DataPoints
			}
		}
		t.Fatal("the gauge was not exported")
		return nil
	}

	now := time.Now()
	held.held("owner-a", now.Add(-90*time.Second))
	held.held("owner-b", now.Add(-10*time.Second))

	points := observed()
	require.Len(t, points, 1, "one series, not one per owner")
	assert.Empty(t, points[0].Attributes.ToSlice(), "an exported series names no owner")
	assert.InDelta(t, 90, points[0].Value, 5, "the roll held longest is the age the series carries")

	held.ended("owner-a")
	points = observed()
	require.Len(t, points, 1)
	assert.InDelta(t, 10, points[0].Value, 5)

	held.m["owner-b"] = heldRoll{since: now, seen: now.Add(-heldRollStale - time.Second)}
	held.held("owner-c", now.Add(-3*time.Second))
	points = observed()
	require.Len(t, points, 1)
	assert.InDelta(t, 3, points[0].Value, 5, "a hold no pass refreshed has been dropped")

	held.ended("owner-c")
	points = observed()
	require.Len(t, points, 1)
	assert.Equal(t, int64(0), points[0].Value, "no held roll reads zero rather than the last age it had")
}
