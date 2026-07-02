package telemetry

import (
	"net/http"
	"sync/atomic"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// exportEnabled is set once by Setup; WrapTransport consults it so callers can
// wrap unconditionally and still pay nothing when telemetry is off.
var exportEnabled atomic.Bool

// WrapTransport instruments an HTTP round-tripper with client spans and
// metrics, so outbound calls (every Kubernetes API request, the idle checker's
// busy probe) appear as children of the reconcile span in the request context.
// When telemetry is disabled it returns rt untouched. A nil rt wraps
// http.DefaultTransport.
func WrapTransport(rt http.RoundTripper) http.RoundTripper {
	if !exportEnabled.Load() {
		return rt
	}
	if rt == nil {
		rt = http.DefaultTransport
	}
	return otelhttp.NewTransport(rt,
		// Default client span names are just the method; method + path says
		// which API call dominated a slow phase.
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			return r.Method + " " + r.URL.Path
		}),
	)
}
