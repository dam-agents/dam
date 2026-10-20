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

// UNIT_BOUNDARY_DESCRIPTION: how long the roll held longest right now has waited, as an observation of the rolls held right now rather than a value written per pass: a gauge that is recorded keeps a series for every owner it ever saw, so an owner whose roll ended would export its last age forever, and owners that churn would fill the SDK's series limit. A hold is dropped when the reconciler ends it, and on its own when no pass refreshed it for heldRollStale, so a runner deleted or a template reverted mid-wait stops being observed; heldRollStale outlives the backstops that refresh a live hold — the drift pass, which hands its agents over five minutes and runs later under queue congestion, and the ten-minute rollout sweep — by a wide margin, since a hold that waited for one of them is being held and dropping it would export zero in the middle of it and reset whatever alert reads the series. The series carries no owner: a runner is per owner, so its owner on a series would be a person, which no exported series names. An operator reads which runner is held from the Events on it.
const heldRollStale = 30 * time.Minute

const (
	heldRollName = "platform.vm_runner.roll_held_for_idle"
	heldRollDesc = "How long the changed pod held longest right now has been held back from its roll, for busy agents or for a node image cache the runner cannot reach; zero when no roll is held"
)

type heldRoll struct {
	since time.Time
	seen  time.Time
}

type heldRolls struct {
	mu sync.Mutex
	m  map[string]heldRoll
}

var runnerRollHeld = &heldRolls{m: map[string]heldRoll{}}

// UNIT_BOUNDARY_DESCRIPTION: one pass that keeps the hold, with the instant it started, which the reconciler reads from the runner's own annotation rather than counting from this process's start.
func (h *heldRolls) held(owner string, since time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.m[owner] = heldRoll{since: since, seen: time.Now()}
}

// UNIT_BOUNDARY_DESCRIPTION: the pass that ends the hold, so the series goes rather than being left at its last age.
func (h *heldRolls) ended(owner string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.m, owner)
}

func (h *heldRolls) observe(now time.Time, o metric.Int64Observer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	var oldest time.Duration
	for owner, roll := range h.m {
		if now.Sub(roll.seen) >= heldRollStale {
			delete(h.m, owner)
			continue
		}
		oldest = max(oldest, now.Sub(roll.since))
	}
	o.Observe(int64(oldest.Seconds()))
}

func newHeldRollGauge(meter metric.Meter, h *heldRolls) (metric.Int64ObservableGauge, error) {
	return meter.Int64ObservableGauge(heldRollName,
		metric.WithDescription(heldRollDesc),
		metric.WithUnit("s"),
		metric.WithInt64Callback(func(_ context.Context, o metric.Int64Observer) error {
			h.observe(time.Now(), o)
			return nil
		}))
}

var runnerRollHeldGauge = sync.OnceValue(func() metric.Int64ObservableGauge {
	gauge, err := newHeldRollGauge(otel.Meter(ScopeName), runnerRollHeld)
	if err != nil {
		otel.Handle(err)
	}
	return gauge
})

// UNIT_BOUNDARY_DESCRIPTION: a pass that keeps a runner's roll held, named by owner and by when the hold started.
func RunnerRollHeld(owner string, since time.Time) {
	runnerRollHeldGauge()
	runnerRollHeld.held(owner, since)
}

// UNIT_BOUNDARY_DESCRIPTION: a pass that finds the hold over, so nothing is exported for that owner until it is held again.
func RunnerRollEnded(owner string) {
	runnerRollHeldGauge()
	runnerRollHeld.ended(owner)
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
