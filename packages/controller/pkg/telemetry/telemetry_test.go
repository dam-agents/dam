package telemetry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSetupDisabledWithoutEndpoint(t *testing.T) {
	for _, k := range []string{
		"OTEL_SDK_DISABLED",
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
		"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
	} {
		t.Setenv(k, "")
	}

	shutdown, enabled, err := Setup(context.Background())
	require.NoError(t, err)
	assert.False(t, enabled)
	assert.NoError(t, shutdown(context.Background()))
}

func TestSetupDisabledByOtelSdkDisabled(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318")
	t.Setenv("OTEL_SDK_DISABLED", "true")

	_, enabled, err := Setup(context.Background())
	require.NoError(t, err)
	assert.False(t, enabled)
}

func TestSetupEnabledWithEndpoint(t *testing.T) {
	t.Setenv("OTEL_SDK_DISABLED", "")
	collector := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer collector.Close()
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.URL)

	shutdown, enabled, err := Setup(context.Background())
	require.NoError(t, err)
	assert.True(t, enabled)
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	_ = shutdown(ctx)
}
