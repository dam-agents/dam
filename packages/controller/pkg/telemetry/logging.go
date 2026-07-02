package telemetry

import (
	"context"
	"errors"
	"log/slog"
	"os"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel/trace"
)

// NewHandler builds the process slog handler. Disabled, it is exactly the
// plain JSON-on-stderr handler the controller has always used. Enabled, every
// record fans out to two children: the stderr JSON handler (byte-identical
// stream, plus trace_id/span_id fields when the record's context carries a
// span) and the OTel log bridge, which exports the record over OTLP with its
// own trace correlation.
func NewHandler(level slog.Level, enabled bool) slog.Handler {
	stderr := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level})
	if !enabled {
		return stderr
	}
	return fanoutHandler{handlers: []slog.Handler{
		traceContextHandler{inner: stderr},
		leveledHandler{min: level, inner: otelslog.NewHandler(ScopeName)},
	}}
}

// traceContextHandler stamps trace_id/span_id onto records logged inside a
// span, so the stderr stream correlates with exported traces.
type traceContextHandler struct {
	inner slog.Handler
}

func (h traceContextHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h traceContextHandler) Handle(ctx context.Context, rec slog.Record) error {
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		rec.AddAttrs(
			slog.String("trace_id", sc.TraceID().String()),
			slog.String("span_id", sc.SpanID().String()),
		)
	}
	return h.inner.Handle(ctx, rec)
}

func (h traceContextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return traceContextHandler{inner: h.inner.WithAttrs(attrs)}
}

func (h traceContextHandler) WithGroup(name string) slog.Handler {
	return traceContextHandler{inner: h.inner.WithGroup(name)}
}

// leveledHandler applies the process LOG_LEVEL to a child that has no level
// gate of its own (the OTel bridge), keeping both streams at one level.
type leveledHandler struct {
	min   slog.Level
	inner slog.Handler
}

func (h leveledHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return level >= h.min && h.inner.Enabled(ctx, level)
}

func (h leveledHandler) Handle(ctx context.Context, rec slog.Record) error {
	return h.inner.Handle(ctx, rec)
}

func (h leveledHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return leveledHandler{min: h.min, inner: h.inner.WithAttrs(attrs)}
}

func (h leveledHandler) WithGroup(name string) slog.Handler {
	return leveledHandler{min: h.min, inner: h.inner.WithGroup(name)}
}

// fanoutHandler delivers each record to every child that accepts its level.
// One child failing never blocks the others; errors are joined.
type fanoutHandler struct {
	handlers []slog.Handler
}

func (h fanoutHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, c := range h.handlers {
		if c.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

func (h fanoutHandler) Handle(ctx context.Context, rec slog.Record) error {
	var errs []error
	for _, c := range h.handlers {
		if c.Enabled(ctx, rec.Level) {
			// Clone: a handler may mutate the record's attrs.
			if err := c.Handle(ctx, rec.Clone()); err != nil {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}

func (h fanoutHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	children := make([]slog.Handler, len(h.handlers))
	for i, c := range h.handlers {
		children[i] = c.WithAttrs(attrs)
	}
	return fanoutHandler{handlers: children}
}

func (h fanoutHandler) WithGroup(name string) slog.Handler {
	children := make([]slog.Handler, len(h.handlers))
	for i, c := range h.handlers {
		children[i] = c.WithGroup(name)
	}
	return fanoutHandler{handlers: children}
}
