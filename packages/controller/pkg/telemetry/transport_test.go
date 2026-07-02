package telemetry

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWrapTransportIdentityWhenDisabled(t *testing.T) {
	exportEnabled.Store(false)
	rt := http.DefaultTransport
	assert.Equal(t, rt, WrapTransport(rt))
	assert.Nil(t, WrapTransport(nil))
}

func TestWrapTransportInstrumentsWhenEnabled(t *testing.T) {
	exportEnabled.Store(true)
	t.Cleanup(func() { exportEnabled.Store(false) })
	wrapped := WrapTransport(http.DefaultTransport)
	assert.NotEqual(t, http.DefaultTransport, wrapped)
	assert.NotNil(t, WrapTransport(nil))
}
