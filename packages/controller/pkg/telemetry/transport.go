package telemetry

import (
	"net/http"
	"sync/atomic"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

var exportEnabled atomic.Bool

func WrapTransport(rt http.RoundTripper) http.RoundTripper {
	if !exportEnabled.Load() {
		return rt
	}
	if rt == nil {
		rt = http.DefaultTransport
	}
	return otelhttp.NewTransport(rt,
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			return r.Method + " " + r.URL.Path
		}),
	)
}
