package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

// spanContext returns a context carrying a valid recording span.
func spanContext(t *testing.T) (context.Context, trace.SpanContext) {
	t.Helper()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(tracetest.NewSpanRecorder()))
	t.Cleanup(func() { _ = tp.Shutdown(context.Background()) })
	ctx, span := tp.Tracer("test").Start(context.Background(), "test-span")
	t.Cleanup(func() { span.End() })
	return ctx, span.SpanContext()
}

func TestNewHandlerDisabledIsPlainJSON(t *testing.T) {
	h := NewHandler(slog.LevelInfo, false)
	_, isJSON := h.(*slog.JSONHandler)
	assert.True(t, isJSON, "disabled handler must be the plain JSON handler")
	assert.False(t, h.Enabled(context.Background(), slog.LevelDebug))
	assert.True(t, h.Enabled(context.Background(), slog.LevelInfo))
}

func TestTraceContextHandlerStampsIDsInsideSpan(t *testing.T) {
	var buf bytes.Buffer
	h := traceContextHandler{inner: slog.NewJSONHandler(&buf, nil)}
	logger := slog.New(h)

	ctx, sc := spanContext(t)
	logger.InfoContext(ctx, "inside span")

	var line map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &line))
	assert.Equal(t, sc.TraceID().String(), line["trace_id"])
	assert.Equal(t, sc.SpanID().String(), line["span_id"])
}

func TestTraceContextHandlerPlainOutsideSpan(t *testing.T) {
	var buf bytes.Buffer
	h := traceContextHandler{inner: slog.NewJSONHandler(&buf, nil)}
	slog.New(h).Info("outside span")

	var line map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &line))
	assert.NotContains(t, line, "trace_id")
	assert.NotContains(t, line, "span_id")
}

// recordingHandler counts records delivered to it.
type recordingHandler struct {
	records *[]slog.Record
	min     slog.Level
}

func (h recordingHandler) Enabled(_ context.Context, l slog.Level) bool { return l >= h.min }
func (h recordingHandler) Handle(_ context.Context, r slog.Record) error {
	*h.records = append(*h.records, r)
	return nil
}
func (h recordingHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h recordingHandler) WithGroup(string) slog.Handler      { return h }

func TestFanoutDeliversToAllEnabledChildren(t *testing.T) {
	var a, b []slog.Record
	h := fanoutHandler{handlers: []slog.Handler{
		recordingHandler{records: &a, min: slog.LevelInfo},
		recordingHandler{records: &b, min: slog.LevelWarn},
	}}
	logger := slog.New(h)

	logger.Info("info goes to a only")
	logger.Warn("warn goes to both")

	assert.Len(t, a, 2)
	assert.Len(t, b, 1)
}

func TestFanoutRespectsChildLevels(t *testing.T) {
	var a []slog.Record
	h := fanoutHandler{handlers: []slog.Handler{
		recordingHandler{records: &a, min: slog.LevelWarn},
	}}
	assert.False(t, h.Enabled(context.Background(), slog.LevelInfo))
	assert.True(t, h.Enabled(context.Background(), slog.LevelWarn))
}

func TestLeveledHandlerGates(t *testing.T) {
	var recs []slog.Record
	h := leveledHandler{min: slog.LevelInfo, inner: recordingHandler{records: &recs, min: slog.LevelDebug}}
	assert.False(t, h.Enabled(context.Background(), slog.LevelDebug))
	assert.True(t, h.Enabled(context.Background(), slog.LevelInfo))
}

// The enabled handler's stderr child must produce the same JSON shape as
// today's plain handler for records outside a span.
func TestEnabledStderrChildMatchesPlainOutput(t *testing.T) {
	var plain, wrapped bytes.Buffer
	opts := &slog.HandlerOptions{Level: slog.LevelInfo}

	slog.New(slog.NewJSONHandler(&plain, opts)).Info("hello", "k", "v")
	slog.New(traceContextHandler{inner: slog.NewJSONHandler(&wrapped, opts)}).Info("hello", "k", "v")

	stripTime := func(b []byte) map[string]any {
		var m map[string]any
		require.NoError(t, json.Unmarshal(b, &m))
		delete(m, "time")
		return m
	}
	assert.Equal(t, stripTime(plain.Bytes()), stripTime(wrapped.Bytes()))
}
