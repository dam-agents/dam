package main

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	nooptrace "go.opentelemetry.io/otel/trace/noop"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/util/workqueue"
)

type fakeItem struct {
	Name string
}

func decodeFakeItem(obj any) (*fakeItem, error) {
	u, ok := obj.(*unstructured.Unstructured)
	if !ok {
		return nil, errors.New("not unstructured")
	}
	return &fakeItem{Name: u.GetName()}, nil
}

// spanRecorder swaps in a recording tracer provider for the test.
func spanRecorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder)))
	t.Cleanup(func() { otel.SetTracerProvider(nooptrace.NewTracerProvider()) })
	return recorder
}

func newFakeLister(t *testing.T, namespace string, names ...string) cache.GenericLister {
	t.Helper()
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, name := range names {
		u := &unstructured.Unstructured{}
		u.SetName(name)
		u.SetNamespace(namespace)
		u.SetKind("Fake")
		u.SetAPIVersion("test/v1")
		require.NoError(t, indexer.Add(u))
	}
	return cache.NewGenericLister(indexer, schema.GroupResource{Group: "test", Resource: "fakes"})
}

func attrValue(span sdktrace.ReadOnlySpan, key string) string {
	for _, kv := range span.Attributes() {
		if string(kv.Key) == key {
			return kv.Value.AsString()
		}
	}
	return ""
}

func TestRunCachedWorkerEmitsReconcileSpans(t *testing.T) {
	recorder := spanRecorder(t)

	queue := workqueue.NewTypedRateLimitingQueueWithConfig(workqueue.DefaultTypedControllerRateLimiter[string](),
		workqueue.TypedRateLimitingQueueConfig[string]{Name: "test"})
	lister := newFakeLister(t, "ns", "a", "b")

	var calls atomic.Int32
	done := make(chan struct{})
	reconcile := func(ctx context.Context, item *fakeItem) error {
		if calls.Add(1) == 2 {
			close(done)
		}
		return nil
	}

	// Distinct names — the queue dedupes identical pending items.
	queue.Add("a")
	queue.Add("missing")
	queue.Add("b")

	go func() {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
		}
		queue.ShutDown()
	}()
	runCachedWorker(context.Background(), "fake", lister, "ns", queue, decodeFakeItem, reconcile)

	spans := recorder.Ended()
	require.GreaterOrEqual(t, len(spans), 3)

	outcomes := map[string]int{}
	for _, s := range spans {
		assert.Equal(t, "reconcile fake", s.Name())
		assert.Equal(t, "fake", attrValue(s, "platform.resource.kind"))
		outcomes[attrValue(s, "platform.reconcile.outcome")]++
	}
	assert.Equal(t, 2, outcomes["success"])
	assert.Equal(t, 1, outcomes["not_found"])
}

func TestRunCachedWorkerErrorOutcome(t *testing.T) {
	recorder := spanRecorder(t)

	queue := workqueue.NewTypedRateLimitingQueueWithConfig(workqueue.DefaultTypedControllerRateLimiter[string](),
		workqueue.TypedRateLimitingQueueConfig[string]{Name: "test"})
	lister := newFakeLister(t, "ns", "flaky")

	// Fails once (re-queued rate-limited), then succeeds.
	var calls atomic.Int32
	done := make(chan struct{})
	reconcile := func(ctx context.Context, item *fakeItem) error {
		if calls.Add(1) == 1 {
			return errors.New("boom")
		}
		close(done)
		return nil
	}

	queue.Add("flaky")
	go func() {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
		}
		queue.ShutDown()
	}()
	runCachedWorker(context.Background(), "fake", lister, "ns", queue, decodeFakeItem, reconcile)

	outcomes := map[string]int{}
	for _, s := range recorder.Ended() {
		outcomes[attrValue(s, "platform.reconcile.outcome")]++
	}
	assert.Equal(t, 1, outcomes["error"])
	assert.Equal(t, 1, outcomes["success"])
}
