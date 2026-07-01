package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	apitypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
)

func setupRunReconciler(t *testing.T, run *apiv1.Run, objects ...runtime.Object) (*RunReconciler, *fake.Clientset) {
	t.Helper()
	// The executor routes through the parent's already-running gateway, so the
	// parent gateway Service must exist with a ClusterIP.
	objects = append(objects, &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: GatewayName("my-agent"), Namespace: "test-agents"},
		Spec:       corev1.ServiceSpec{ClusterIP: "10.96.7.7"},
	})
	client := fake.NewSimpleClientset(objects...)
	cfg := &config.Config{
		Namespace:          "test-agents",
		ReleaseNamespace:   "default",
		ReleaseName:        "platform",
		HarnessServerPort:  4001,
		EnvoyPort:          10000,
		IstioTrustDomain:   "cluster.local",
		IstioWaypointName:  "apiserver-waypoint",
		AgentProbesEnabled: true,
		AgentTemplateDefaults: config.AgentTemplateDefaults{
			AgentHome:       "/home/agent",
			ImagePullPolicy: "IfNotPresent",
		},
	}
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(run)
	require.NoError(t, err)
	u := &unstructured.Unstructured{Object: raw}
	u.SetAPIVersion(apiv1.GroupVersion.String())
	u.SetKind("Run")
	getter := &fakeGetter{agents: map[string]*apiv1.Agent{"my-agent": agentCR()}}
	r := NewRunReconciler(client, cfg, NewAgentResolver(getter)).WithDynamicClient(newFakeDynamic(u))
	r.now = func() time.Time { return time.Unix(1_000_000, 0) }
	return r, client
}

func runCR(name string, createdAt time.Time) *apiv1.Run {
	return &apiv1.Run{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents", UID: apitypes.UID("run-uid-" + name),
			CreationTimestamp: metav1.Time{Time: createdAt},
		},
		Spec: apiv1.RunSpec{AgentName: "my-agent"},
	}
}

func readRunStatus(t *testing.T, r *RunReconciler, name string) *apiv1.RunStatus {
	t.Helper()
	u, err := r.dynamic.Resource(RunsGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	raw, ok, _ := unstructured.NestedMap(u.Object, "status")
	if !ok || raw == nil {
		return nil
	}
	var s apiv1.RunStatus
	require.NoError(t, runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &s))
	return &s
}

func TestRunReconcile_CreatesExecutorPod(t *testing.T) {
	run := runCR("run-1", time.Unix(1_000_000-1, 0))
	r, client := setupRunReconciler(t, run)

	require.NoError(t, r.Reconcile(context.Background(), run))

	pod, err := client.CoreV1().Pods("test-agents").Get(context.Background(), "run-1", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, RoleAgent, pod.Labels[LabelRole])
	assert.Equal(t, "run-1", pod.Labels[RunLabelRunID])
	assert.Equal(t, RunPodLabelType, pod.Labels[ForkLabelType])
	assert.Equal(t, "none", pod.Labels["istio.io/dataplane-mode"])
	// No per-run SA — the executor borrows the parent gateway's egress identity.
	assert.Empty(t, pod.Spec.ServiceAccountName)

	env := map[string]string{}
	for _, e := range pod.Spec.Containers[0].Env {
		env[e.Name] = e.Value
	}
	assert.Equal(t, "1", env["PLATFORM_EXEC_ONLY"], "executor must boot agent-runtime in exec-only mode")
	// Egress is pointed at the parent gateway's ClusterIP.
	assert.Contains(t, env["HTTPS_PROXY"], "10.96.7.7")

	status := readRunStatus(t, r, "run-1")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.RunPhasePending, status.Phase)
}

// The executor's egress NetworkPolicy must admit it (its own pair) to the
// PARENT's gateway — that's what lets it share the parent gateway.
func TestRunReconcile_EgressTargetsParentGateway(t *testing.T) {
	run := runCR("run-np", time.Unix(1_000_000-1, 0))
	r, client := setupRunReconciler(t, run)
	require.NoError(t, r.Reconcile(context.Background(), run))

	np, err := client.NetworkingV1().NetworkPolicies("test-agents").
		Get(context.Background(), "run-np-agent-egress", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "run-np", np.Spec.PodSelector.MatchLabels[LabelPair])
	require.Len(t, np.Spec.Egress, 1)
	require.Len(t, np.Spec.Egress[0].To, 1)
	to := np.Spec.Egress[0].To[0].PodSelector.MatchLabels
	assert.Equal(t, "my-agent", to[LabelPair])
	assert.Equal(t, RoleGateway, to[LabelRole])
}

func TestRunReconcile_WritesReadyOnPodReady(t *testing.T) {
	run := runCR("run-2", time.Unix(1_000_000-1, 0))
	r, _ := setupRunReconciler(t, run, &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: "run-2", Namespace: "test-agents",
			Labels: map[string]string{RunLabelRunID: "run-2"},
		},
		Status: corev1.PodStatus{
			PodIP:      "10.1.2.3",
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}},
		},
	})

	require.NoError(t, r.Reconcile(context.Background(), run))
	status := readRunStatus(t, r, "run-2")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.RunPhaseReady, status.Phase)
	assert.Equal(t, "10.1.2.3", status.PodIP)
}

func TestRunReconcile_ReapsOverAgeRun(t *testing.T) {
	run := runCR("run-stale", time.Unix(1_000_000, 0).Add(-2*RunMaxLifetime))
	r, _ := setupRunReconciler(t, run)

	require.NoError(t, r.Reconcile(context.Background(), run))

	_, err := r.dynamic.Resource(RunsGVR).Namespace("test-agents").
		Get(context.Background(), "run-stale", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "over-age run should be deleted")
}
