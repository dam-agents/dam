package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

func TestBuildExtAuthzService_SelectorUsesInstanceLabel_NotFullname(t *testing.T) {
	cfg := &config.Config{
		ReleaseNamespace:       "default",
		ReleaseName:            "dam-platform",
		APIServerInstanceLabel: "dam",
		ExtAuthzPort:           4002,
	}
	svc := BuildExtAuthzService("inst-1", cfg)
	assert.Equal(t, "dam", svc.Spec.Selector["app.kubernetes.io/instance"],
		"selector must match the chart's .Release.Name-based instance label, not the fullname-based ReleaseName")
	assert.Equal(t, "apiserver", svc.Spec.Selector["app.kubernetes.io/component"])
	assert.Equal(t, "dam-platform-extauthz-inst-1", svc.Name,
		"Service name continues to use fullname (ReleaseName)")
}
