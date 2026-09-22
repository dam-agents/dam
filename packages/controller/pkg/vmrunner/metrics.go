package vmrunner

import (
	"math"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const metricsNamespace = "platform_vm_runner"

// UNIT_BOUNDARY_DESCRIPTION: what a runner measures about its own machines and its image cache, for the platform's collector to scrape. Every label value comes from a fixed set in this file or in the machine API — an operation, an outcome, a failure reason, a cache result — and never from a machine, an image or an owner: a machine id or an image reference would grow a series per agent, and the runner exists per owner, so either would be a person's identity in disguise. The runner itself is the only thing that tells one set of series from another.
type metrics struct {
	registry   *prometheus.Registry
	operations *prometheus.HistogramVec
	starts     *prometheus.HistogramVec
	ready      *prometheus.HistogramVec
	restarts   prometheus.Counter
	failures   *prometheus.CounterVec
	refusals   prometheus.Counter
	lookups    *prometheus.CounterVec
	fetches    *prometheus.HistogramVec
	evictions  prometheus.Counter
	evicted    prometheus.Counter
	cacheBytes prometheus.Gauge
}

var bootBuckets = []float64{0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600}

var fetchBuckets = []float64{1, 5, 10, 30, 60, 120, 300, 600, 1200}

// UNIT_BOUNDARY_DESCRIPTION: an operation is named by what it does to the machine rather than by the state the machine reports while it runs, so a dashboard reads create, wake, restart and stop. The set is closed: anything the runner does not know is reported as other rather than as its own label.
func operationLabel(op string) string {
	switch op {
	case StateCreating:
		return "create"
	case StateStarting:
		return "wake"
	case StateRestarting:
		return "restart"
	case StateStopping:
		return "stop"
	}
	return "other"
}

func outcomeLabel(err error) string {
	if err != nil {
		return "failed"
	}
	return "ok"
}

func newMetrics(s *Server) *metrics {
	m := &metrics{
		registry: prometheus.NewRegistry(),
		operations: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: metricsNamespace, Name: "machine_operation_duration_seconds",
			Help:    "Wall time of a machine operation the controller asked for, from the moment it runs to its end, image fetch included.",
			Buckets: bootBuckets,
		}, []string{"op", "outcome"}),
		starts: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: metricsNamespace, Name: "machine_start_duration_seconds",
			Help:    "Wall time of the runtime's own start call, the part of a create, wake or restart that boots the VMM.",
			Buckets: bootBuckets,
		}, []string{"op", "outcome"}),
		ready: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: metricsNamespace, Name: "machine_ready_seconds",
			Help:    "Time from asking a machine to start to the first health check its guest answered.",
			Buckets: bootBuckets,
		}, []string{"op"}),
		restarts: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: metricsNamespace, Name: "machine_unhealthy_restarts_total",
			Help: "Machines restarted because a guest that had answered stopped answering.",
		}),
		failures: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: metricsNamespace, Name: "machine_operation_failures_total",
			Help: "Machine operations that failed, by the reason the Agent is told.",
		}, []string{"op", "reason"}),
		refusals: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: metricsNamespace, Name: "machine_admission_refusals_total",
			Help: "Requests to start a machine refused because its memory did not fit what the runner has left; an Agent parked on this is asked for again, and each refusal counts.",
		}),
		lookups: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: metricsNamespace, Name: "image_cache_lookups_total",
			Help: "Machine creates by whether the image cache already held a bootable tree of their image.",
		}, []string{"result"}),
		fetches: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: metricsNamespace, Name: "image_fetch_duration_seconds",
			Help:    "Wall time of fetching and unpacking an image into the cache.",
			Buckets: fetchBuckets,
		}, []string{"outcome"}),
		evictions: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: metricsNamespace, Name: "image_cache_evictions_total",
			Help: "Cached images removed to stay inside the budget.",
		}),
		evicted: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: metricsNamespace, Name: "image_cache_evicted_bytes_total",
			Help: "Bytes freed by evicting cached images.",
		}),
		cacheBytes: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: metricsNamespace, Name: "image_cache_bytes",
			Help: "Bytes the cached images occupied after the last eviction pass.",
		}),
	}
	m.registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		m.operations, m.starts, m.ready, m.restarts, m.failures, m.refusals,
		m.lookups, m.fetches, m.evictions, m.evicted, m.cacheBytes,
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Namespace: metricsNamespace, Name: "image_cache_budget_bytes",
			Help: "Bytes the cached images may occupy.",
		}, func() float64 { return float64(s.ImageBudget) }),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Namespace: metricsNamespace, Name: "memory_limit_mib",
			Help: "Memory the runner may commit to machines, before its own reserve.",
		}, func() float64 { return float64(s.MemoryMiB) }),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Namespace: metricsNamespace, Name: "memory_reserve_mib",
			Help: "Memory the runner keeps for itself when admitting a machine.",
		}, func() float64 { return float64(s.ReserveMiB) }),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Namespace: metricsNamespace, Name: "memory_committed_mib",
			Help: "Memory committed to running machines and to machines being started, as admission counts it.",
		}, func() float64 {
			used, err := s.committedMiB("")
			if err != nil {
				return math.NaN()
			}
			return float64(used)
		}),
	)
	return m
}

func (m *metrics) operation(op string, took time.Duration, err error) {
	if m == nil {
		return
	}
	m.operations.WithLabelValues(operationLabel(op), outcomeLabel(err)).Observe(took.Seconds())
}

func (m *metrics) start(op string, took time.Duration, err error) {
	if m == nil {
		return
	}
	m.starts.WithLabelValues(operationLabel(op), outcomeLabel(err)).Observe(took.Seconds())
}

func (m *metrics) becameReady(op string, took time.Duration) {
	if m == nil {
		return
	}
	m.ready.WithLabelValues(operationLabel(op)).Observe(took.Seconds())
}

func (m *metrics) unhealthyRestart() {
	if m == nil {
		return
	}
	m.restarts.Inc()
}

func (m *metrics) failed(op, reason string) {
	if m == nil {
		return
	}
	m.failures.WithLabelValues(operationLabel(op), reason).Inc()
}

func (m *metrics) refused() {
	if m == nil {
		return
	}
	m.refusals.Inc()
}

func (m *metrics) lookup(hit bool) {
	if m == nil {
		return
	}
	result := "miss"
	if hit {
		result = "hit"
	}
	m.lookups.WithLabelValues(result).Inc()
}

func (m *metrics) fetched(took time.Duration, err error) {
	if m == nil {
		return
	}
	m.fetches.WithLabelValues(outcomeLabel(err)).Observe(took.Seconds())
}

func (m *metrics) evictedImage(bytes int64) {
	if m == nil {
		return
	}
	m.evictions.Inc()
	m.evicted.Add(float64(bytes))
}

func (m *metrics) cacheSize(bytes int64) {
	if m == nil {
		return
	}
	m.cacheBytes.Set(float64(bytes))
}

// UNIT_BOUNDARY_DESCRIPTION: the scrape endpoint, served apart from the machine API and without its token. The token is what lets a caller create and delete machines, and a scraper that held it could do both; what this serves names no machine, image or owner, so the NetworkPolicy that admits only the platform's collector to its port is the whole of its gate. A runner that has not started — the Preloader, which drives the cache code with no runner behind it — has nothing to serve.
func (s *Server) MetricsHandler() http.Handler {
	if s.metrics == nil {
		return http.NotFoundHandler()
	}
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", promhttp.HandlerFor(s.metrics.registry, promhttp.HandlerOpts{}))
	return mux
}
