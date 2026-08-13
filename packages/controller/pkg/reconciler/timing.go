package reconciler

import (
	"context"
	"log/slog"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

const slowReconcileThreshold = 2 * time.Second

type reconcileTimer struct {
	ctx   context.Context
	kind  string
	name  string
	span  trace.Span
	start time.Time
	last  time.Time
	marks []any
}

func newReconcileTimer(ctx context.Context, kind, name string) *reconcileTimer {
	now := time.Now()
	return &reconcileTimer{ctx: ctx, kind: kind, name: name, span: trace.SpanFromContext(ctx), start: now, last: now}
}

func (t *reconcileTimer) mark(phase string) {
	now := time.Now()
	t.marks = append(t.marks, slog.Duration(phase, now.Sub(t.last)))
	t.span.AddEvent(phase)
	t.last = now
}

func (t *reconcileTimer) done() {
	total := time.Since(t.start)
	attrs := make([]any, 0, len(t.marks)+2)
	attrs = append(attrs, slog.String(t.kind, t.name), slog.Duration("total", total))
	attrs = append(attrs, t.marks...)
	if total >= slowReconcileThreshold {
		t.span.SetAttributes(attribute.Bool("platform.reconcile.slow", true))
		slog.WarnContext(t.ctx, "slow reconcile", attrs...)
		return
	}
	slog.DebugContext(t.ctx, "reconcile timing", attrs...)
}
