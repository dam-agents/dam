package telemetry

import (
	"context"
	"log/slog"
	"os"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel/trace"
)

func NewHandler(level slog.Level, enabled bool) slog.Handler {
	stderr := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level})
	if !enabled {
		return stderr
	}
	return slog.NewMultiHandler(
		traceContextHandler{inner: stderr},
		leveledHandler{min: level, inner: otelslog.NewHandler(ScopeName)},
	)
}

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
