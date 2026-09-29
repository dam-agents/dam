package telemetry

import (
	"context"
	"sort"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// UNIT_BOUNDARY_DESCRIPTION: what the controller last saw of the install's VM runners, as a whole. A runner exists per owner, so no series names a runner, an owner or a machine: a machine id or the owner's hash would each make a series a person. Each field counts runners or machines across the install, and the one label, the reason a node gave for not resizing a pod, comes from a closed set.
type RunnerHealth struct {
	MachinesDesired int64
	MachinesUp      int64
	RunnersShort    int64
	RollsWaiting    int64
	RollWaitOldest  float64
	RollsStalled    int64
	ResizePending   map[string]int64
	DrainsHeld      int64
}

// UNIT_BOUNDARY_DESCRIPTION: the gauges are read at each export from whatever read returns, so the pass that fills them never touches an instrument and a pass that has not run yet reads as zero.
func ObserveRunnerHealth(read func() RunnerHealth) error {
	return observeRunnerHealth(otel.Meter(ScopeName), read)
}

func observeRunnerHealth(meter metric.Meter, read func() RunnerHealth) error {
	gauge := func(name, unit, desc string) (metric.Int64ObservableGauge, error) {
		return meter.Int64ObservableGauge(name, metric.WithUnit(unit), metric.WithDescription(desc))
	}
	desired, err := gauge("platform.vm_runner.machines.desired", "{machine}", "vm machines their agents want running, across every runner")
	if err != nil {
		return err
	}
	up, err := gauge("platform.vm_runner.machines.up", "{machine}", "vm machines that want to run and whose guest answers, across every runner")
	if err != nil {
		return err
	}
	short, err := gauge("platform.vm_runner.short", "{runner}", "runners with fewer machines up than their agents want running")
	if err != nil {
		return err
	}
	waiting, err := gauge("platform.vm_runner.rolls_waiting", "{runner}", "runners whose pod changed and that wait for a place in the roll")
	if err != nil {
		return err
	}
	oldest, err := meter.Float64ObservableGauge("platform.vm_runner.roll_wait_oldest", metric.WithUnit("s"),
		metric.WithDescription("how long the runner that has waited longest for a place in the roll has waited"))
	if err != nil {
		return err
	}
	stalled, err := gauge("platform.vm_runner.rolls_stalled", "{runner}", "rolls whose new pod was not ready by the settle timeout and that hold the roll")
	if err != nil {
		return err
	}
	resize, err := gauge("platform.vm_runner.resize_pending", "{pod}", "runner pods whose in-place memory resize the node has not applied, by the node's reason")
	if err != nil {
		return err
	}
	held, err := gauge("platform.vm_runner.drains_held", "{runner}", "runners on an unschedulable node whose disruption budget still holds a drain off")
	if err != nil {
		return err
	}
	_, err = meter.RegisterCallback(func(_ context.Context, o metric.Observer) error {
		h := read()
		o.ObserveInt64(desired, h.MachinesDesired)
		o.ObserveInt64(up, h.MachinesUp)
		o.ObserveInt64(short, h.RunnersShort)
		o.ObserveInt64(waiting, h.RollsWaiting)
		o.ObserveFloat64(oldest, h.RollWaitOldest)
		o.ObserveInt64(stalled, h.RollsStalled)
		o.ObserveInt64(held, h.DrainsHeld)
		reasons := make([]string, 0, len(h.ResizePending))
		for reason := range h.ResizePending {
			reasons = append(reasons, reason)
		}
		sort.Strings(reasons)
		for _, reason := range reasons {
			o.ObserveInt64(resize, h.ResizePending[reason], metric.WithAttributes(attribute.String("platform.vm_runner.resize_reason", reason)))
		}
		return nil
	}, desired, up, short, waiting, oldest, stalled, resize, held)
	return err
}
