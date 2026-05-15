package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// The per-instance ext-authz Service must select apiserver pods by the
// chart's `app.kubernetes.io/instance` label, which carries the Helm
// `.Release.Name`. Wiring the selector to `cfg.ReleaseName` (which is the
// chart's `platform.fullname` — release+chart) silently produces a
// selector that matches no pods whenever the chart name isn't a substring
// of the release name (e.g. release `dam`, chart `platform`), and envoy
// ext-authz then fails closed with "no healthy upstream".
func TestBuildExtAuthzService_SelectorUsesInstanceLabel_NotFullname(t *testing.T) {
	cfg := &config.Config{
		ReleaseNamespace:       "default",
		ReleaseName:            "dam-platform", // fullname
		APIServerInstanceLabel: "dam",          // .Release.Name
		ExtAuthzPort:           4002,
	}
	svc := BuildExtAuthzService("inst-1", cfg, nil)
	assert.Equal(t, "dam", svc.Spec.Selector["app.kubernetes.io/instance"],
		"selector must match the chart's .Release.Name-based instance label, not the fullname-based ReleaseName")
	assert.Equal(t, "apiserver", svc.Spec.Selector["app.kubernetes.io/component"])
	assert.Equal(t, "dam-platform-extauthz-inst-1", svc.Name,
		"Service name continues to use fullname (ReleaseName)")
}
