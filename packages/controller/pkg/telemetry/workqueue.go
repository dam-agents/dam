package telemetry

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"k8s.io/client-go/util/workqueue"
)

// workqueueMetricsProvider backs client-go's workqueue metrics hooks with OTel
// instruments, one attribute set per named queue. client-go skips metrics for
// unnamed queues, so every queue must be constructed with a Name.
type workqueueMetricsProvider struct {
	depth        metric.Int64UpDownCounter
	adds         metric.Int64Counter
	latency      metric.Float64Histogram
	workDuration metric.Float64Histogram
	unfinished   metric.Float64Gauge
	longestRun   metric.Float64Gauge
	retries      metric.Int64Counter
}

func newWorkqueueMetricsProvider(meter metric.Meter) *workqueueMetricsProvider {
	p := &workqueueMetricsProvider{}
	var err error
	mustInstrument := func(e error) {
		if e != nil && err == nil {
			err = e
		}
	}
	var e error
	p.depth, e = meter.Int64UpDownCounter("platform.workqueue.depth",
		metric.WithDescription("Items waiting in the queue"))
	mustInstrument(e)
	p.adds, e = meter.Int64Counter("platform.workqueue.adds",
		metric.WithDescription("Items enqueued"))
	mustInstrument(e)
	p.latency, e = meter.Float64Histogram("platform.workqueue.latency",
		metric.WithDescription("Time an item waits in the queue before processing"),
		metric.WithUnit("s"))
	mustInstrument(e)
	p.workDuration, e = meter.Float64Histogram("platform.workqueue.work_duration",
		metric.WithDescription("Time processing an item takes"),
		metric.WithUnit("s"))
	mustInstrument(e)
	p.unfinished, e = meter.Float64Gauge("platform.workqueue.unfinished_work",
		metric.WithDescription("Seconds of work in progress not yet observed by work_duration"),
		metric.WithUnit("s"))
	mustInstrument(e)
	p.longestRun, e = meter.Float64Gauge("platform.workqueue.longest_running_processor",
		metric.WithDescription("Longest an in-flight item has been processing"),
		metric.WithUnit("s"))
	mustInstrument(e)
	p.retries, e = meter.Int64Counter("platform.workqueue.retries",
		metric.WithDescription("Items re-enqueued rate-limited"))
	mustInstrument(e)
	if err != nil {
		// Instrument creation only fails on invalid names — a programming
		// error; surface it but keep the controller running with whatever
		// instruments did register (nil ones are guarded below).
		slog.Warn("workqueue metrics instrument creation failed", "error", err)
	}
	return p
}

func (p *workqueueMetricsProvider) attrs(name string) metric.MeasurementOption {
	return metric.WithAttributes(attribute.String("workqueue.name", name))
}

func (p *workqueueMetricsProvider) NewDepthMetric(name string) workqueue.GaugeMetric {
	return upDownGauge{c: p.depth, opts: p.attrs(name)}
}

func (p *workqueueMetricsProvider) NewAddsMetric(name string) workqueue.CounterMetric {
	return counter{c: p.adds, opts: p.attrs(name)}
}

func (p *workqueueMetricsProvider) NewLatencyMetric(name string) workqueue.HistogramMetric {
	return histogram{h: p.latency, opts: p.attrs(name)}
}

func (p *workqueueMetricsProvider) NewWorkDurationMetric(name string) workqueue.HistogramMetric {
	return histogram{h: p.workDuration, opts: p.attrs(name)}
}

func (p *workqueueMetricsProvider) NewUnfinishedWorkSecondsMetric(name string) workqueue.SettableGaugeMetric {
	return settableGauge{g: p.unfinished, opts: p.attrs(name)}
}

func (p *workqueueMetricsProvider) NewLongestRunningProcessorSecondsMetric(name string) workqueue.SettableGaugeMetric {
	return settableGauge{g: p.longestRun, opts: p.attrs(name)}
}

func (p *workqueueMetricsProvider) NewRetriesMetric(name string) workqueue.CounterMetric {
	return counter{c: p.retries, opts: p.attrs(name)}
}

// The workqueue records measurements outside any request, so the adapters use
// context.Background(); attributes carry the queue identity.

type upDownGauge struct {
	c    metric.Int64UpDownCounter
	opts metric.MeasurementOption
}

func (g upDownGauge) Inc() {
	if g.c != nil {
		g.c.Add(context.Background(), 1, g.opts)
	}
}

func (g upDownGauge) Dec() {
	if g.c != nil {
		g.c.Add(context.Background(), -1, g.opts)
	}
}

type counter struct {
	c    metric.Int64Counter
	opts metric.MeasurementOption
}

func (c counter) Inc() {
	if c.c != nil {
		c.c.Add(context.Background(), 1, c.opts)
	}
}

type histogram struct {
	h    metric.Float64Histogram
	opts metric.MeasurementOption
}

func (h histogram) Observe(v float64) {
	if h.h != nil {
		h.h.Record(context.Background(), v, h.opts)
	}
}

type settableGauge struct {
	g    metric.Float64Gauge
	opts metric.MeasurementOption
}

func (g settableGauge) Set(v float64) {
	if g.g != nil {
		g.g.Record(context.Background(), v, g.opts)
	}
}
