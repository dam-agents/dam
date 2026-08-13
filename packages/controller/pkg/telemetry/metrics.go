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
	OutcomeDecodeError     = "decode_error"
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
