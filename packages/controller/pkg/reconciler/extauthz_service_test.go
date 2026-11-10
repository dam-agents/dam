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

func TestBuildExtAuthzService_BoundToWaypoint(t *testing.T) {
	cfg := &config.Config{
		ReleaseNamespace:       "default",
		ReleaseName:            "dam-platform",
		APIServerInstanceLabel: "dam",
		ExtAuthzPort:           4002,
		IstioWaypointName:      "apiserver-waypoint",
	}
	svc := BuildExtAuthzService("inst-1", cfg)
	assert.Equal(t, "apiserver-waypoint", svc.Labels["istio.io/use-waypoint"],
		"without the label the per-agent authorization policy is not bound to a waypoint, so the mesh never enforces it")
}

// TEST_SCENARIO: a Service created before the waypoint binding existed gains the label on the next reconcile and keeps its ClusterIP, so the per-agent policy takes effect without an operator recreating it.
func TestApplyExtAuthzService_BindsAnExistingServiceToTheWaypoint(t *testing.T) {
	ctx := context.Background()
	cfg := &config.Config{
		ReleaseNamespace:       "default",
		ReleaseName:            "dam-platform",
		APIServerInstanceLabel: "dam",
		ExtAuthzPort:           4002,
		IstioWaypointName:      "apiserver-waypoint",
	}
	current := BuildExtAuthzService("inst-1", cfg)
	current.Spec.ClusterIP = "10.0.0.17"
	delete(current.Labels, "istio.io/use-waypoint")
	r := &AgentReconciler{config: cfg, client: fake.NewSimpleClientset(current)}

	require.NoError(t, r.applyExtAuthzService(ctx, BuildExtAuthzService("inst-1", cfg)))

	got, err := r.client.CoreV1().Services(cfg.ReleaseNamespace).Get(ctx, cfg.ExtAuthzServiceName("inst-1"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "apiserver-waypoint", got.Labels["istio.io/use-waypoint"])
	assert.Equal(t, "10.0.0.17", got.Spec.ClusterIP)
}
