package reconciler

import (
	"context"
	"log/slog"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// slowReconcileThreshold: total wall-clock above which a reconcile's phase
// timing is logged at Warn instead of Debug.
const slowReconcileThreshold = 2 * time.Second

// reconcileTimer attributes one reconcile's wall-clock to its phases, so a slow
// reconcile points at the API call that dominated. done() is defer-friendly: it
// fires on early error returns too, showing how far the reconcile got. Phases
// also land as events on the reconcile span (a no-op span when telemetry is
// off), so a trace shows the same breakdown.
type reconcileTimer struct {
	ctx   context.Context
	kind  string // "agent" | "fork"
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

// mark records the time since the previous mark under phase.
func (t *reconcileTimer) mark(phase string) {
	now := time.Now()
	t.marks = append(t.marks, slog.Duration(phase, now.Sub(t.last)))
	t.span.AddEvent(phase)
	t.last = now
}

// done emits total + per-phase timing: Warn past slowReconcileThreshold (visible
// at the default level), Debug otherwise.
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
