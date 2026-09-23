// TEST_OVERVIEW: the runner's metrics are what the platform reads to judge the vm backend against the container one, so they must count what they claim to: each create, wake and restart and how long its boot and its first health answer took; an unhealthy restart, a failed operation by the reason the Agent is told, and a refused admission; the memory committed against the runner's limit; and the image cache's hits, misses, fetches and evictions. No series may carry a machine, an image or anything else that names an agent or its owner, and the scrape needs no machine API token.
package vmrunner

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	dto "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func (h *harness) family(t *testing.T, name string) *dto.MetricFamily {
	t.Helper()
	families, err := h.node.metrics.registry.Gather()
	require.NoError(t, err)
	for _, f := range families {
		if f.GetName() == metricsNamespace+"_"+name {
			return f
		}
	}
	return nil
}

func (h *harness) sample(t *testing.T, name string, labels map[string]string) *dto.Metric {
	t.Helper()
	f := h.family(t, name)
	if f == nil {
		return nil
	}
	for _, m := range f.GetMetric() {
		matches := 0
		for _, l := range m.GetLabel() {
			if want, ok := labels[l.GetName()]; ok && want == l.GetValue() {
				matches++
			}
		}
		if matches == len(labels) {
			return m
		}
	}
	return nil
}

func (h *harness) observed(t *testing.T, name string, labels map[string]string) uint64 {
	t.Helper()
	m := h.sample(t, name, labels)
	if m == nil {
		return 0
	}
	return m.GetHistogram().GetSampleCount()
}

func (h *harness) counted(t *testing.T, name string, labels map[string]string) float64 {
	t.Helper()
	m := h.sample(t, name, labels)
	if m == nil {
		return 0
	}
	if m.GetCounter() != nil {
		return m.GetCounter().GetValue()
	}
	return m.GetGauge().GetValue()
}

func (h *harness) awaitReady(t *testing.T, id string) {
	t.Helper()
	require.Eventually(t, func() bool {
		st, err := h.client().Status(t.Context(), id)
		return err == nil && st.Ready && st.State == StateRunning
	}, 5*time.Second, 10*time.Millisecond)
}

// TEST_SCENARIO: an agent is created, hibernated and woken. The create and the wake are each measured as a whole operation, as the runtime start inside it, and as the time until the guest first answered — once each, under their own name, so a dashboard can put the vm backend's create and wake beside the container backend's.
func TestACreateAndAWakeAreEachMeasuredThroughToReady(t *testing.T) {
	h := newHarness(t)
	guestServing(t, h.node.PortMin+loopbackOffset)
	c := h.client()

	_, err := c.Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	h.awaitReady(t, "m1")
	h.settle(t, "m1")
	assert.EqualValues(t, 1, h.observed(t, "machine_operation_duration_seconds", map[string]string{"op": "create", "outcome": "ok"}))
	assert.EqualValues(t, 1, h.observed(t, "machine_start_duration_seconds", map[string]string{"op": "create", "outcome": "ok"}))
	assert.EqualValues(t, 1, h.observed(t, "machine_ready_seconds", map[string]string{"op": "create"}))

	_, err = c.Status(t.Context(), "m1")
	require.NoError(t, err)
	assert.EqualValues(t, 1, h.observed(t, "machine_ready_seconds", map[string]string{"op": "create"}), "a boot becomes ready once, however often it is polled after")

	_, err = c.Ensure(t.Context(), "m1", spec(false))
	require.NoError(t, err)
	h.settle(t, "m1")
	_, err = c.Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	h.awaitReady(t, "m1")
	h.settle(t, "m1")
	assert.EqualValues(t, 1, h.observed(t, "machine_operation_duration_seconds", map[string]string{"op": "stop", "outcome": "ok"}))
	assert.EqualValues(t, 1, h.observed(t, "machine_operation_duration_seconds", map[string]string{"op": "wake", "outcome": "ok"}))
	assert.EqualValues(t, 1, h.observed(t, "machine_start_duration_seconds", map[string]string{"op": "wake", "outcome": "ok"}))
	assert.EqualValues(t, 1, h.observed(t, "machine_ready_seconds", map[string]string{"op": "wake"}))
}

// TEST_SCENARIO: a guest that answered and went quiet is restarted by the runner itself, which no caller asked for — so it is counted apart from the restarts a changed spec causes, and the restart's own boot is measured as one.
func TestAnUnhealthyRestartIsCounted(t *testing.T) {
	h := newHarness(t)
	_, err := h.client().Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	h.settle(t, "m1")
	h.node.mu.Lock()
	h.node.health["m1"] = health{everReady: true, quietSince: time.Now().Add(-unhealthyRestart - time.Minute)}
	h.node.mu.Unlock()

	_, err = h.client().Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	h.settle(t, "m1")
	assert.EqualValues(t, 1, h.counted(t, "machine_unhealthy_restarts_total", nil))
	assert.EqualValues(t, 1, h.observed(t, "machine_start_duration_seconds", map[string]string{"op": "restart", "outcome": "ok"}))
}

// TEST_SCENARIO: a boot the runtime refuses is counted under the reason the Agent is told, and a machine that does not fit is counted as a refusal rather than as a failed operation — it never became one.
func TestFailuresAreCountedByReasonAndRefusalsApart(t *testing.T) {
	t.Setenv("FAKE_START_FAIL_ONCE", "the VMM refused to boot")
	h := newHarness(t)
	h.node.MemoryMiB, h.node.ReserveMiB = 3000, 0
	_, err := h.client().Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	st := h.settle(t, "m1")
	require.Equal(t, ReasonBootFailed, st.Reason)
	assert.EqualValues(t, 1, h.counted(t, "machine_operation_failures_total", map[string]string{"op": "create", "reason": ReasonBootFailed}))
	assert.EqualValues(t, 1, h.observed(t, "machine_start_duration_seconds", map[string]string{"op": "create", "outcome": "failed"}))

	large := spec(true)
	large.MemoryMiB = 4000
	_, err = h.client().Ensure(t.Context(), "m2", large)
	require.NoError(t, err)
	assert.EqualValues(t, 1, h.counted(t, "machine_admission_refusals_total", nil))
	assert.Nil(t, h.sample(t, "machine_operation_failures_total", map[string]string{"reason": ReasonOutOfCapacity}), "nothing was spawned for the refused machine")
}

// TEST_SCENARIO: committed memory is read the way admission reads it, so the two numbers an operator compares are the ones the runner decides by.
func TestCommittedMemoryIsReportedAgainstTheLimit(t *testing.T) {
	h := newHarness(t)
	h.node.MemoryMiB, h.node.ReserveMiB = 8192, 512
	_, err := h.client().Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	h.settle(t, "m1")

	assert.EqualValues(t, 2048, h.counted(t, "memory_committed_mib", nil))
	assert.EqualValues(t, 8192, h.counted(t, "memory_limit_mib", nil))
	assert.EqualValues(t, 512, h.counted(t, "memory_reserve_mib", nil))
}

// TEST_SCENARIO: the first machine of an image misses the cache and fetches it; the second finds the tree the first left and hits. An eviction pass then counts what it removed and what the cache holds after.
func TestTheImageCacheCountsHitsMissesFetchesAndEvictions(t *testing.T) {
	h := newHarness(t)
	_, err := h.client().Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	h.settle(t, "m1")
	_, err = h.client().Ensure(t.Context(), "m2", spec(true))
	require.NoError(t, err)
	h.settle(t, "m2")

	assert.EqualValues(t, 1, h.counted(t, "image_cache_lookups_total", map[string]string{"result": "miss"}))
	assert.EqualValues(t, 1, h.counted(t, "image_cache_lookups_total", map[string]string{"result": "hit"}))
	assert.EqualValues(t, 1, h.observed(t, "image_fetch_duration_seconds", map[string]string{"outcome": "ok"}))

	old := h.node.ImageDir + "/old.tar"
	require.NoError(t, os.WriteFile(old, make([]byte, 1<<20), 0o644))
	require.NoError(t, os.Chtimes(old, time.Now().Add(-time.Hour), time.Now().Add(-time.Hour)))
	h.node.evictImages(h.node.ImageDir, "", 1)
	assert.EqualValues(t, 1, h.counted(t, "image_cache_evictions_total", nil))
	assert.EqualValues(t, 1<<20, h.counted(t, "image_cache_evicted_bytes_total", nil))
	assert.Positive(t, h.counted(t, "image_cache_bytes", nil), "the tree the machines run from is left, and counted")
}

// TEST_SCENARIO: the scrape is plain HTTP without the machine API's token, because the token creates and deletes machines. That is only safe while nothing it serves names a machine or an image — so every label value is checked after the runner has handled both.
func TestTheScrapeNeedsNoTokenAndNamesNoMachineOrImage(t *testing.T) {
	h := newHarness(t)
	_, err := h.client().Ensure(t.Context(), "agent-secret-name", spec(true))
	require.NoError(t, err)
	h.settle(t, "agent-secret-name")

	scrape := httptest.NewServer(h.node.MetricsHandler())
	t.Cleanup(scrape.Close)
	resp, err := http.Get(scrape.URL + "/metrics")
	require.NoError(t, err)
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	text := string(body)
	assert.Contains(t, text, metricsNamespace+"_machine_operation_duration_seconds")
	assert.NotContains(t, text, "agent-secret-name")
	assert.NotContains(t, text, "quay.io")

	families, err := h.node.metrics.registry.Gather()
	require.NoError(t, err)
	for _, f := range families {
		if !strings.HasPrefix(f.GetName(), metricsNamespace) {
			continue
		}
		for _, m := range f.GetMetric() {
			for _, l := range m.GetLabel() {
				assert.Contains(t, []string{"op", "outcome", "reason", "result"}, l.GetName(), "%s carries a label outside the closed set", f.GetName())
			}
		}
	}
}

// TEST_SCENARIO: the Preloader drives the cache code with no runner behind it and never starts one, so there is nothing to scrape — the cache code it shares must not fail for want of metrics either.
func TestARunnerThatNeverStartedServesNoMetrics(t *testing.T) {
	s := &Server{}
	rec := httptest.NewRecorder()
	s.MetricsHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.NotPanics(t, func() { s.evictImages(t.TempDir(), "", 1) })
}
