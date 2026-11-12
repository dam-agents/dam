package reconciler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
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

// TEST_SCENARIO: an upgrade from a release that bound ext-authz Services to the api-server waypoint unbinds them; a bound Service puts every agent's waypoint policy into its own chain, which crash-looped prod's waypoint.
func TestApplyExtAuthzService_UnbindsAServiceBoundToTheWaypoint(t *testing.T) {
	ctx := context.Background()
	cfg := &config.Config{ReleaseNamespace: "default", ReleaseName: "dam-platform", APIServerInstanceLabel: "dam", ExtAuthzPort: 4002}
	bound := BuildExtAuthzService("inst-1", cfg)
	bound.Labels["istio.io/use-waypoint"] = "apiserver-waypoint"
	r := &AgentReconciler{config: cfg, client: fake.NewSimpleClientset(bound)}

	require.NoError(t, r.applyExtAuthzService(ctx, BuildExtAuthzService("inst-1", cfg)))

	got, err := r.client.CoreV1().Services("default").Get(ctx, bound.Name, metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotContains(t, got.Labels, "istio.io/use-waypoint")
}
