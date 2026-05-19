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
	"k8s.io/apimachinery/pkg/runtime"
	apitypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
	"gopkg.in/yaml.v3"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

func setupForkReconciler(t *testing.T, agents map[string]*corev1.ConfigMap, objects ...runtime.Object) (*ForkReconciler, *fake.Clientset) {
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
		EnvoyImage:         "envoyproxy/envoy:distroless-v1.37.2",
		EnvoyPort:          10000,
		IstioTrustDomain:   "cluster.local",
		IstioWaypointName:  "apiserver-waypoint",
		AgentProbesEnabled: true,
	}
	getter := &fakeGetter{cms: agents}
	// ADR-041: ForkReconciler writes per-fork AuthorizationPolicies via
	// the dynamic client; tests need a fake that knows the GVR.
	r := NewForkReconciler(client, cfg, NewAgentResolver(getter)).WithDynamicClient(newFakeDynamic())
	r.now = func() time.Time { return time.Unix(1_000_000, 0) }
	return r, client
}

func forkCM(t *testing.T, name string, spec *types.ForkSpec, createdAt time.Time) *corev1.ConfigMap {
	t.Helper()
	data, err := yaml.Marshal(spec)
	require.NoError(t, err)
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents", UID: apitypes.UID("fork-uid-" + name),
			CreationTimestamp: metav1.Time{Time: createdAt},
			Labels: map[string]string{
				"agent-platform.ai/type":     "agent-fork",
				"agent-platform.ai/instance": spec.Instance,
				"agent-platform.ai/fork-id":  name,
			},
		},
		Data: map[string]string{"spec.yaml": string(data)},
	}
}

func readStatus(t *testing.T, client *fake.Clientset, name string) *types.ForkStatus {
	t.Helper()
	cm, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	statusYAML, ok := cm.Data["status.yaml"]
	if !ok {
		return nil
	}
	var s types.ForkStatus
	require.NoError(t, yaml.Unmarshal([]byte(statusYAML), &s))
	return &s
}

func minimalForkSpec(instance string) *types.ForkSpec {
	return &types.ForkSpec{
		Version:    types.SpecVersion,
		Instance:   instance,
		ForeignSub: "kc-user-42",
	}
}

func TestForkReconcile_CreatesJob(t *testing.T) {
	cm := forkCM(t, "fork-1", minimalForkSpec("my-instance"), time.Unix(1_000_000-1, 0))
	r, client := setupForkReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
		instanceCM("running"),
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)

	job, err := client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-1", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "fork-1", job.Labels["agent-platform.ai/fork-id"])

	status := readStatus(t, client, "fork-1")
	require.NotNil(t, status)
	assert.Equal(t, types.ForkPhasePending, status.Phase)
}

func TestForkReconcile_WritesReadyOnPodReady(t *testing.T) {
	cm := forkCM(t, "fork-2", minimalForkSpec("my-instance"), time.Unix(1_000_000-1, 0))
	r, client := setupForkReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
		instanceCM("running"),
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

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)

	status := readStatus(t, client, "fork-2")
	require.NotNil(t, status)
	assert.Equal(t, types.ForkPhaseReady, status.Phase)
	assert.Equal(t, "10.0.0.5", status.PodIP)
	assert.Equal(t, "fork-2", status.JobName)
}

func TestForkReconcile_TimeoutEmitsFailed(t *testing.T) {
	cm := forkCM(t, "fork-3", minimalForkSpec("my-instance"), time.Unix(1_000_000-200, 0))
	r, client := setupForkReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
		instanceCM("running"),
	)

	err := r.Reconcile(context.Background(), cm)
	require.Error(t, err)

	status := readStatus(t, client, "fork-3")
	require.NotNil(t, status)
	assert.Equal(t, types.ForkPhaseFailed, status.Phase)
	require.NotNil(t, status.Error)
	assert.Equal(t, types.ForkReasonTimeout, status.Error.Reason)
}

func TestForkReconcile_JobFailedEmitsPodNotReady(t *testing.T) {
	cm := forkCM(t, "fork-4", minimalForkSpec("my-instance"), time.Unix(1_000_000-1, 0))
	r, client := setupForkReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
		instanceCM("running"),
	)

	require.NoError(t, r.Reconcile(context.Background(), cm))

	job, err := client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-4", metav1.GetOptions{})
	require.NoError(t, err)
	job.Status.Conditions = []batchv1.JobCondition{{
		Type: batchv1.JobFailed, Status: corev1.ConditionTrue, Reason: "BackoffLimitExceeded", Message: "pod failed",
	}}
	_, err = client.BatchV1().Jobs("test-agents").Update(context.Background(), job, metav1.UpdateOptions{})
	require.NoError(t, err)

	err = r.Reconcile(context.Background(), cm)
	require.Error(t, err)

	status := readStatus(t, client, "fork-4")
	require.NotNil(t, status)
	assert.Equal(t, types.ForkPhaseFailed, status.Phase)
	require.NotNil(t, status.Error)
	assert.Equal(t, types.ForkReasonPodNotReady, status.Error.Reason)
}

func TestForkReconcile_MissingInstanceEmitsOrchestrationFailed(t *testing.T) {
	cm := forkCM(t, "fork-5", minimalForkSpec("ghost-instance"), time.Unix(1_000_000-1, 0))
	r, client := setupForkReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
	)

	err := r.Reconcile(context.Background(), cm)
	require.Error(t, err)

	status := readStatus(t, client, "fork-5")
	require.NotNil(t, status)
	assert.Equal(t, types.ForkPhaseFailed, status.Phase)
	require.NotNil(t, status.Error)
	assert.Equal(t, types.ForkReasonOrchestrationFailed, status.Error.Reason)
}

func TestForkReconcile_InvalidSpecEmitsOrchestrationFailed(t *testing.T) {
	r, client := setupForkReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
	)
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "fork-6", Namespace: "test-agents",
			CreationTimestamp: metav1.Time{Time: time.Unix(1_000_000-1, 0)},
			Labels:            map[string]string{"agent-platform.ai/type": "agent-fork"},
		},
		Data: map[string]string{"spec.yaml": "this is not: valid: yaml: at all"},
	}
	_, err := client.CoreV1().ConfigMaps("test-agents").Create(context.Background(), cm, metav1.CreateOptions{})
	require.NoError(t, err)

	err = r.Reconcile(context.Background(), cm)
	require.Error(t, err)

	status := readStatus(t, client, "fork-6")
	require.NotNil(t, status)
	assert.Equal(t, types.ForkPhaseFailed, status.Phase)
}

func TestForkReconcile_TerminalPhasesAreNoOp(t *testing.T) {
	cm := forkCM(t, "fork-7", minimalForkSpec("my-instance"), time.Unix(1_000_000-1, 0))
	cm.Data["status.yaml"] = "version: agent-platform.ai/v1\nphase: Completed\n"
	r, client := setupForkReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
		instanceCM("running"),
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)

	_, err = client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-7", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "no job should be created after terminal phase")
}
