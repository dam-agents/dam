// TEST_OVERVIEW: the runner health gauges are what the chart's alerts select, so their names, units and the one label they carry are pinned here, as is each gauge reading what the controller's pass last saw.
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

// TEST_SCENARIO: every gauge is exported under the name the alerts select and reads the last health the pass stored, and the resize gauge is split by the node's reason and nothing else.
func TestRunnerHealthGaugesReadTheLastPass(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	meter := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)).Meter("test")
	require.NoError(t, observeRunnerHealth(meter, func() RunnerHealth {
		return RunnerHealth{
			MachinesDesired: 5, MachinesUp: 4, RunnersShort: 1,
			RollsWaiting: 2, RollWaitOldest: 90, RollsStalled: 1,
			ResizePending: map[string]int64{"Deferred": 3}, DrainsHeld: 1,
		}
	}))

	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &rm))
	require.Len(t, rm.ScopeMetrics, 1)
	got := map[string]float64{}
	units := map[string]string{}
	for _, m := range rm.ScopeMetrics[0].Metrics {
		units[m.Name] = m.Unit
		switch data := m.Data.(type) {
		case metricdata.Gauge[int64]:
			require.Len(t, data.DataPoints, 1, m.Name)
			got[m.Name] = float64(data.DataPoints[0].Value)
			if m.Name == "platform.vm_runner.resize_pending" {
				assert.Equal(t, attribute.NewSet(attribute.String("platform.vm_runner.resize_reason", "Deferred")), data.DataPoints[0].Attributes)
			} else {
				assert.Zero(t, data.DataPoints[0].Attributes.Len(), m.Name)
			}
		case metricdata.Gauge[float64]:
			require.Len(t, data.DataPoints, 1, m.Name)
			got[m.Name] = data.DataPoints[0].Value
		default:
			t.Fatalf("%s is not a gauge", m.Name)
		}
	}
	assert.Equal(t, map[string]float64{
		"platform.vm_runner.machines.desired": 5,
		"platform.vm_runner.machines.up":      4,
		"platform.vm_runner.short":            1,
		"platform.vm_runner.rolls_waiting":    2,
		"platform.vm_runner.roll_wait_oldest": 90,
		"platform.vm_runner.rolls_stalled":    1,
		"platform.vm_runner.resize_pending":   3,
		"platform.vm_runner.drains_held":      1,
	}, got)
	assert.Equal(t, "s", units["platform.vm_runner.roll_wait_oldest"])
}
