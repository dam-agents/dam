// Package telemetry wires the in-process OpenTelemetry SDK: traces, metrics,
// and logs exported over OTLP to the endpoint named by the standard OTEL_*
// environment variables. When no endpoint is configured the package is a
// complete no-op — the otel globals stay no-op implementations, no exporter or
// goroutine is created, and instrumentation call sites cost near nothing.
package telemetry

import (
	"context"
	"errors"
	"log/slog"
	"os"

	"go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/log/global"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"k8s.io/client-go/util/workqueue"
)

// ScopeName is the instrumentation scope for all controller telemetry, and the
// default service.name (OTEL_SERVICE_NAME overrides it).
const ScopeName = "platform-controller"

// Setup initializes the OTel SDK when an OTLP endpoint is configured via the
// standard environment variables. It returns whether export is enabled and a
// shutdown func that flushes buffered telemetry (a no-op when disabled).
// Must run before any workqueue is constructed — it registers the queue
// metrics provider.
func Setup(ctx context.Context) (shutdown func(context.Context) error, enabled bool, err error) {
	noop := func(context.Context) error { return nil }
	if os.Getenv("OTEL_SDK_DISABLED") == "true" || !exportConfigured() {
		return noop, false, nil
	}

	res, err := resource.New(ctx,
		// Default service.name first; WithFromEnv follows so
		// OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES win.
		resource.WithAttributes(attribute.String("service.name", ScopeName)),
		resource.WithFromEnv(),
	)
	if err != nil {
		return noop, false, err
	}

	traceExp, err := otlptracehttp.New(ctx)
	if err != nil {
		return noop, false, err
	}
	metricExp, err := otlpmetrichttp.New(ctx)
	if err != nil {
		return noop, false, err
	}
	logExp, err := otlploghttp.New(ctx)
	if err != nil {
		return noop, false, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithBatcher(traceExp),
	)
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp)),
	)
	lp := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(logExp)),
	)

	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	global.SetLoggerProvider(lp)

	// Exporter failures must never reach a reconcile path; they drop data and
	// log a warning. The handler writes through its own plain stderr logger —
	// never the process-default fanout handler, which would loop when the log
	// exporter itself is what failed.
	errLogger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		errLogger.Warn("otel export error", "error", err)
	}))

	if err := runtime.Start(runtime.WithMeterProvider(mp)); err != nil {
		errLogger.Warn("otel runtime metrics unavailable", "error", err)
	}
	workqueue.SetProvider(newWorkqueueMetricsProvider(mp.Meter(ScopeName)))
	exportEnabled.Store(true)

	return func(ctx context.Context) error {
		return errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx), lp.Shutdown(ctx))
	}, true, nil
}

// exportConfigured reports whether any standard OTLP endpoint variable is set.
func exportConfigured() bool {
	for _, k := range []string{
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
		"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
	} {
		if os.Getenv(k) != "" {
			return true
		}
	}
	return false
}
