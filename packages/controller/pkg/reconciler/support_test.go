package reconciler

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"testing"
)

// UNIT_BOUNDARY_DESCRIPTION: the controller's log, taken whole so a test asserts on what an operator would read there rather than on a return value alone. A record keeps its message and its attributes: a test matches and counts messages, and a failure shows the whole line, message and attributes, so it names the owner, the runner and the list the record is about. The controller logs from several goroutines at once, so the records are guarded.
type capturedLog struct {
	mu      sync.Mutex
	records []slog.Record
}

func captureLog(t *testing.T) *capturedLog {
	t.Helper()
	captured := &capturedLog{}
	previous := slog.Default()
	slog.SetDefault(slog.New(captured))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return captured
}

func (l *capturedLog) Enabled(context.Context, slog.Level) bool { return true }

func (l *capturedLog) Handle(_ context.Context, record slog.Record) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.records = append(l.records, record)
	return nil
}

func (l *capturedLog) WithAttrs([]slog.Attr) slog.Handler { return l }

func (l *capturedLog) WithGroup(string) slog.Handler { return l }

// UNIT_BOUNDARY_DESCRIPTION: every record the controller logged, in the order it logged them, so a test reads one record's message and attributes or counts them.
func (l *capturedLog) all() []slog.Record {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]slog.Record(nil), l.records...)
}

// UNIT_BOUNDARY_DESCRIPTION: every record's message in order, without its attributes, so a test counts how often one thing was said.
func (l *capturedLog) messages() []string {
	out := []string{}
	for _, record := range l.all() {
		out = append(out, record.Message)
	}
	return out
}

// UNIT_BOUNDARY_DESCRIPTION: the lines whose message is exactly this one, message and attributes together, so an assertion that none was said fails with what each said.
func (l *capturedLog) lines(message string) []string {
	out := []string{}
	for _, record := range l.all() {
		if record.Message != message {
			continue
		}
		var attrs []string
		record.Attrs(func(attr slog.Attr) bool {
			attrs = append(attrs, attr.Key+"="+attr.Value.String())
			return true
		})
		out = append(out, strings.Join(append([]string{record.Message}, attrs...), " "))
	}
	return out
}

// UNIT_BOUNDARY_DESCRIPTION: the value a record carries under this key, and a zero value for a record that carries none.
func logAttr(record slog.Record, key string) slog.Value {
	var found slog.Value
	record.Attrs(func(attr slog.Attr) bool {
		if attr.Key == key {
			found = attr.Value
			return false
		}
		return true
	})
	return found
}
