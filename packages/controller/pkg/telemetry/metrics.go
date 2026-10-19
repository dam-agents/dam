package telemetry

import (
	"context"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

const (
	OutcomeSuccess         = "success"
	OutcomeError           = "error"
	OutcomeNotFound        = "not_found"
	OutcomeBackoffExceeded = "backoff_exceeded"
)

type reconcileInstruments struct {
	duration metric.Float64Histogram
	total    metric.Int64Counter
}

var instruments = sync.OnceValue(func() reconcileInstruments {
	meter := otel.Meter(ScopeName)
	duration, err := meter.Float64Histogram("platform.reconcile.duration",
		metric.WithDescription("Wall-clock of one reconcile pass"),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(0.005, 0.02, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30))
	if err != nil {
		otel.Handle(err)
	}
	total, err := meter.Int64Counter("platform.reconcile.total",
		metric.WithDescription("Reconcile passes by outcome"))
	if err != nil {
		otel.Handle(err)
	}
	return reconcileInstruments{duration: duration, total: total}
})

func StartReconcile(ctx context.Context, kind, name string) (context.Context, func(outcome string, err error)) {
	start := time.Now()
	ctx, span := otel.Tracer(ScopeName).Start(ctx, "reconcile "+kind, trace.WithAttributes(
		attribute.String("platform.resource.kind", kind),
		attribute.String("platform.resource.name", name),
	))
	return ctx, func(outcome string, err error) {
		span.SetAttributes(attribute.String("platform.reconcile.outcome", outcome))
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, outcome)
		}
		span.End()

		ins := instruments()
		kindOutcome := metric.WithAttributes(
			attribute.String("platform.resource.kind", kind),
			attribute.String("platform.reconcile.outcome", outcome),
		)
		if ins.duration != nil {
			ins.duration.Record(ctx, time.Since(start).Seconds(), kindOutcome)
		}
		if ins.total != nil {
			ins.total.Add(ctx, 1, kindOutcome)
		}
	}
}

var runnerRollStalled = sync.OnceValue(func() metric.Int64Counter {
	counter, err := otel.Meter(ScopeName).Int64Counter("platform.vm_runner.roll_stalled",
		metric.WithDescription("VM runner rolls whose new pod was not ready by the settle timeout, and which keep their place in the roll"))
	if err != nil {
		otel.Handle(err)
	}
	return counter
})

func RunnerRollStalled(ctx context.Context) {
	if c := runnerRollStalled(); c != nil {
		c.Add(ctx, 1)
	}
}

var runnerHandoffStalled = sync.OnceValue(func() metric.Int64Counter {
	counter, err := otel.Meter(ScopeName).Int64Counter("platform.vm_runner.handoff_stalled",
		metric.WithDescription("VM runner hand-offs to a new release that the runner held as failed, that saw an ensure refused, or that did not settle by the settle timeout, and which halt the release"))
	if err != nil {
		otel.Handle(err)
	}
	return counter
})

func RunnerHandoffStalled(ctx context.Context) {
	if c := runnerHandoffStalled(); c != nil {
		c.Add(ctx, 1)
	}
}

var runnerRollHeldForIdle = sync.OnceValue(func() metric.Int64Gauge {
	gauge, err := otel.Meter(ScopeName).Int64Gauge("platform.vm_runner.roll_held_for_idle",
		metric.WithDescription("How long a VM runner's changed pod has been held back waiting for the owner's agents to go idle, by owner: recorded on every pass that holds it, and zero on the pass that ends the wait"),
		metric.WithUnit("s"))
	if err != nil {
		otel.Handle(err)
	}
	return gauge
})

func RunnerRollHeldForIdle(ctx context.Context, owner string, held time.Duration) {
	if g := runnerRollHeldForIdle(); g != nil {
		g.Record(ctx, int64(held.Seconds()), metric.WithAttributes(attribute.String("platform.vm_runner.owner", owner)))
	}
}

var runnerRollSkipped = sync.OnceValue(func() metric.Int64Counter {
	counter, err := otel.Meter(ScopeName).Int64Counter("platform.vm_runner.roll_skipped",
		metric.WithDescription("VM runner rolls whose new pod was not ready by the settle timeout for a fault of its owner alone, and which gave up their place in the roll"))
	if err != nil {
		otel.Handle(err)
	}
	return counter
})

func RunnerRollSkipped(ctx context.Context) {
	if c := runnerRollSkipped(); c != nil {
		c.Add(ctx, 1)
	}
}

var runtimeMigrationEvents = sync.OnceValue(func() metric.Int64Counter {
	counter, err := otel.Meter(ScopeName).Int64Counter("platform.runtime_migration.events",
		metric.WithDescription("Runtime migration steps the controller reported on an Agent, by the reason of the Kubernetes Event it wrote"))
	if err != nil {
		otel.Handle(err)
	}
	return counter
})

func RuntimeMigrationEvent(ctx context.Context, reason string) {
	if c := runtimeMigrationEvents(); c != nil {
		c.Add(ctx, 1, metric.WithAttributes(attribute.String("platform.runtime_migration.reason", reason)))
	}
}

func SetRequeues(ctx context.Context, n int) {
	trace.SpanFromContext(ctx).SetAttributes(attribute.Int("platform.reconcile.requeues", n))
}

func StartPass(ctx context.Context, name string) (context.Context, func(err error)) {
	ctx, span := otel.Tracer(ScopeName).Start(ctx, name)
	return ctx, func(err error) {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
		}
		span.End()
	}
}
