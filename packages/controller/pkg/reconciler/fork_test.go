package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	apitypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

func setupForkReconciler(t *testing.T, agents map[string]*apiv1.Agent, fork *apiv1.Fork, objects ...runtime.Object) (*ForkReconciler, *fake.Clientset) {
	t.Helper()
	client := fake.NewSimpleClientset(objects...)
	// See setupReconciler — fake clientset doesn't assign ClusterIPs;
	// reactor stamps a stable IP so the fork reconciler can proceed.
	client.PrependReactor("create", "services", func(action k8stesting.Action) (bool, runtime.Object, error) {
		svc := action.(k8stesting.CreateAction).GetObject().(*corev1.Service)
		if svc.Spec.ClusterIP == "" {
			svc.Spec.ClusterIP = "10.96.42.42"
		}
		return false, svc, nil
	})
	cfg := &config.Config{
		Namespace:          "test-agents",
		ReleaseNamespace:   "default",
		ReleaseName:        "platform",
		HarnessServerPort:  4001,
		EnvoyImage:         "mirror.gcr.io/envoyproxy/envoy:distroless-v1.37.2",
		EnvoyPort:          10000,
		IstioTrustDomain:   "cluster.local",
		IstioWaypointName:  "apiserver-waypoint",
		AgentProbesEnabled: true,
	}
	// The Fork CR is seeded into the dynamic fake — the reconciler writes its
	// status subresource there (ADR-058). Agents are resolved via the getter.
	var dynObjs []runtime.Object
	if fork != nil {
		u, err := forkToUnstructured(fork)
		require.NoError(t, err)
		dynObjs = append(dynObjs, u)
	}
	getter := &fakeGetter{agents: agents}
	r := NewForkReconciler(client, cfg, NewAgentResolver(getter)).WithDynamicClient(newFakeDynamic(dynObjs...))
	r.now = func() time.Time { return time.Unix(1_000_000, 0) }
	return r, client
}

func forkCR(name string, spec *types.ForkSpec, createdAt time.Time) *apiv1.Fork {
	return &apiv1.Fork{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents", UID: apitypes.UID("fork-uid-" + name),
			CreationTimestamp: metav1.Time{Time: createdAt},
			Labels: map[string]string{
				LabelAgent:      spec.AgentName,
				ForkLabelForkID: name,
			},
		},
		Spec: *spec,
	}
}

func readForkStatus(t *testing.T, r *ForkReconciler, name string) *apiv1.ForkStatus {
	t.Helper()
	u, err := r.dynamic.Resource(ForksGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	raw, ok, _ := unstructured.NestedMap(u.Object, "status")
	if !ok || raw == nil {
		return nil
	}
	var s apiv1.ForkStatus
	require.NoError(t, runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &s))
	return &s
}

func minimalForkSpec(agentName string) *types.ForkSpec {
	return &types.ForkSpec{
		AgentName:  agentName,
		ForeignSub: "kc-user-42",
	}
}

func TestForkReconcile_CreatesJob(t *testing.T) {
	fork := forkCR("fork-1", minimalForkSpec("my-agent"), time.Unix(1_000_000-1, 0))
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)

	err := r.Reconcile(context.Background(), fork)
	require.NoError(t, err)

	job, err := client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-1", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "fork-1", job.Labels["agent-platform.ai/fork-id"])

	status := readForkStatus(t, r, "fork-1")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhasePending, status.Phase)
}

func TestForkReconcile_WritesReadyOnPodReady(t *testing.T) {
	fork := forkCR("fork-2", minimalForkSpec("my-agent"), time.Unix(1_000_000-1, 0))
	r, _ := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork,
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name: "fork-2-xyz", Namespace: "test-agents",
				Labels: map[string]string{"agent-platform.ai/fork-id": "fork-2"},
			},
			Status: corev1.PodStatus{
				PodIP: "10.0.0.5",
				Conditions: []corev1.PodCondition{
					{Type: corev1.PodReady, Status: corev1.ConditionTrue},
				},
			},
		},
	)

	err := r.Reconcile(context.Background(), fork)
	require.NoError(t, err)

	status := readForkStatus(t, r, "fork-2")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhaseReady, status.Phase)
	assert.Equal(t, "10.0.0.5", status.PodIP)
	assert.Equal(t, "fork-2", status.JobName)
}

func TestForkReconcile_TimeoutEmitsFailed(t *testing.T) {
	fork := forkCR("fork-3", minimalForkSpec("my-agent"), time.Unix(1_000_000-200, 0))
	r, _ := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)

	err := r.Reconcile(context.Background(), fork)
	require.Error(t, err)

	status := readForkStatus(t, r, "fork-3")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhaseFailed, status.Phase)
	require.NotNil(t, status.Error)
	assert.Equal(t, types.ForkReasonTimeout, status.Error.Reason)
}

func TestForkReconcile_JobFailedEmitsPodNotReady(t *testing.T) {
	fork := forkCR("fork-4", minimalForkSpec("my-agent"), time.Unix(1_000_000-1, 0))
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)

	require.NoError(t, r.Reconcile(context.Background(), fork))

	job, err := client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-4", metav1.GetOptions{})
	require.NoError(t, err)
	job.Status.Conditions = []batchv1.JobCondition{{
		Type: batchv1.JobFailed, Status: corev1.ConditionTrue, Reason: "BackoffLimitExceeded", Message: "pod failed",
	}}
	_, err = client.BatchV1().Jobs("test-agents").Update(context.Background(), job, metav1.UpdateOptions{})
	require.NoError(t, err)

	err = r.Reconcile(context.Background(), fork)
	require.Error(t, err)

	status := readForkStatus(t, r, "fork-4")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhaseFailed, status.Phase)
	require.NotNil(t, status.Error)
	assert.Equal(t, types.ForkReasonPodNotReady, status.Error.Reason)
}

func TestForkReconcile_MissingAgentEmitsOrchestrationFailed(t *testing.T) {
	fork := forkCR("fork-5", minimalForkSpec("ghost-agent"), time.Unix(1_000_000-1, 0))
	r, _ := setupForkReconciler(t, map[string]*apiv1.Agent{}, fork)

	err := r.Reconcile(context.Background(), fork)
	require.Error(t, err)

	status := readForkStatus(t, r, "fork-5")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhaseFailed, status.Phase)
	require.NotNil(t, status.Error)
	assert.Equal(t, types.ForkReasonOrchestrationFailed, status.Error.Reason)
}

func TestForkReconcile_TerminalPhasesAreNoOp(t *testing.T) {
	fork := forkCR("fork-7", minimalForkSpec("my-agent"), time.Unix(1_000_000-1, 0))
	fork.Status.Phase = apiv1.ForkPhaseCompleted
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)

	err := r.Reconcile(context.Background(), fork)
	require.NoError(t, err)

	_, err = client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-7", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "no job should be created after terminal phase")
}
