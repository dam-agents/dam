package reconciler

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

var authzPolicyListGVR = schema.GroupVersionResource{Group: "security.istio.io", Version: "v1", Resource: "authorizationpolicies"}

func newFakeDynamic(objects ...runtime.Object) *dynfake.FakeDynamicClient {
	scheme := runtime.NewScheme()
	gvrToListKind := map[schema.GroupVersionResource]string{
		authzPolicyListGVR: "AuthorizationPolicyList",
		AgentsGVR:          "AgentList",
		UserBudgetsGVR:     "UserBudgetList",
	}
	return dynfake.NewSimpleDynamicClientWithCustomListKinds(scheme, gvrToListKind, objects...)
}

func agentToUnstructured(agent *apiv1.Agent) (*unstructured.Unstructured, error) {
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(agent)
	if err != nil {
		return nil, fmt.Errorf("converting Agent to unstructured: %w", err)
	}
	u := &unstructured.Unstructured{Object: raw}
	u.SetAPIVersion(apiv1.GroupVersion.String())
	u.SetKind("Agent")
	return u, nil
}

func agentCR() *apiv1.Agent {
	return &apiv1.Agent{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-agent", Namespace: "test-agents", UID: "agent-uid",
		},
		Spec: *testAgent,
	}
}

// UNIT_BOUNDARY_DESCRIPTION: what an Agent's removal does for the controller's delete queue — the object goes, and the cleanup follows with the UID it went with — so a test calls Delete the way the informer's event does.
func deleteAgentCR(t *testing.T, r *AgentReconciler, name string) types.UID {
	t.Helper()
	ctx := context.Background()
	cli := r.dynamic.Resource(AgentsGVR).Namespace("test-agents")
	stored, err := cli.Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	require.NoError(t, cli.Delete(ctx, name, metav1.DeleteOptions{}))
	return stored.GetUID()
}

func setupReconciler(t *testing.T, agent *apiv1.Agent, objects ...runtime.Object) (*AgentReconciler, *fake.Clientset) {
	t.Helper()
	client := fake.NewSimpleClientset(objects...)
	// UNIT_BOUNDARY_DESCRIPTION: a cluster that answers discovery and does not resize pods in place; a test that wants the resize subresource says so with clusterResizesPods.
	client.Discovery().(*fakediscovery.FakeDiscovery).Resources = []*metav1.APIResourceList{{
		GroupVersion: "v1", APIResources: []metav1.APIResource{{Name: "pods"}, {Name: "pods/status"}},
	}}
	client.PrependReactor("create", "services", func(action k8stesting.Action) (bool, runtime.Object, error) {
		svc := action.(k8stesting.CreateAction).GetObject().(*corev1.Service)
		if svc.Spec.ClusterIP == "" {
			svc.Spec.ClusterIP = "10.96.42.42"
		}
		return false, svc, nil
	})
	cfg := &config.Config{
		Namespace:         "test-agents",
		ReleaseNamespace:  "default",
		ReleaseName:       "platform",
		HarnessServerPort: 4001,
		EnvoyImage:        "mirror.gcr.io/envoyproxy/envoy:distroless-v1.39.4",
		EnvoyPort:         10000,
		IstioTrustDomain:  "cluster.local",
		IstioWaypointName: "apiserver-waypoint",
		AgentBase: config.AgentBase{
			VMIdleTimeout: config.Duration(time.Hour),
		},
		AgentTemplateDefaults: config.AgentTemplateDefaults{
			StorageSize: "10Gi",
		},
		DefaultUserCPUBudget:    resource.MustParse("4"),
		DefaultUserMemoryBudget: resource.MustParse("8Gi"),
		LegacyAgentCPULimit:     resource.MustParse("1"),
		LegacyAgentMemoryLimit:  resource.MustParse("2Gi"),
	}
	var dynObjs []runtime.Object
	if agent != nil {
		u, err := agentToUnstructured(agent)
		require.NoError(t, err)
		dynObjs = append(dynObjs, u)
	}
	r := NewAgentReconciler(client, newFakeDynamic(dynObjs...), cfg)
	return r, client
}

func readyPod(name string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "test-agents"},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}},
		},
	}
}

func agentCondition(t *testing.T, r *AgentReconciler, name, condType string) (string, bool) {
	t.Helper()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	for _, c := range conds {
		m, ok := c.(map[string]interface{})
		if ok && m["type"] == condType {
			st, _ := m["status"].(string)
			return st, true
		}
	}
	return "", false
}

func rolloutSS(name string, generation, observedGen int64, updateRev string) *appsv1.StatefulSet {
	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "test-agents", Generation: generation},
		Spec:       appsv1.StatefulSetSpec{Replicas: new(int32(1))},
		Status:     appsv1.StatefulSetStatus{ObservedGeneration: observedGen, UpdateRevision: updateRev},
	}
}

func podAtRev(name, rev string, ready bool) *corev1.Pod {
	status := corev1.ConditionFalse
	if ready {
		status = corev1.ConditionTrue
	}
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents",
			Labels: map[string]string{"controller-revision-hash": rev},
		},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: status}},
		},
	}
}

func TestPodCurrentAndReady(t *testing.T) {
	cases := []struct {
		name string
		ss   *appsv1.StatefulSet
		pod  *corev1.Pod
		want bool
	}{
		{"ready and on the latest revision", rolloutSS("x", 1, 1, "r1"), podAtRev("x-0", "r1", true), true},
		{"pod on a superseded revision (mid-rollout)", rolloutSS("x", 1, 1, "r2"), podAtRev("x-0", "r1", true), false},
		{"latest template not yet observed", rolloutSS("x", 2, 1, "r1"), podAtRev("x-0", "r1", true), false},
		{"pod current but not ready", rolloutSS("x", 1, 1, "r1"), podAtRev("x-0", "r1", false), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, _ := setupReconciler(t, agentCR(), tc.ss, tc.pod)
			assert.Equal(t, tc.want, r.podCurrentAndReady(context.Background(), "x"))
		})
	}

	t.Run("statefulset absent", func(t *testing.T) {
		r, _ := setupReconciler(t, agentCR())
		assert.False(t, r.podCurrentAndReady(context.Background(), "ghost"))
	})
	t.Run("pod absent", func(t *testing.T) {
		r, _ := setupReconciler(t, agentCR(), rolloutSS("x", 1, 1, "r1"))
		assert.False(t, r.podCurrentAndReady(context.Background(), "x"))
	})
}

func TestForceRollStuckPod_DeletesNotReadyPodAtOldRev(t *testing.T) {
	ss := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent-gateway", Namespace: "test-agents", UID: "ss-uid"},
		Spec: appsv1.StatefulSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"agent-platform.ai/role": "gateway", "agent-platform.ai/pair": "my-agent"}},
		},
		Status: appsv1.StatefulSetStatus{
			CurrentRevision: "rev-1",
			UpdateRevision:  "rev-2",
		},
	}
	stalePod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-agent-gateway-0",
			Namespace: "test-agents",
			Labels: map[string]string{
				"agent-platform.ai/role":   "gateway",
				"agent-platform.ai/pair":   "my-agent",
				"controller-revision-hash": "rev-1",
			},
		},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionFalse}},
		},
	}
	r, client := setupReconciler(t, nil, ss, stalePod)

	require.NoError(t, r.forceRollStuckPod(context.Background(), "test-agents", "my-agent-gateway"))

	_, err := client.CoreV1().Pods("test-agents").Get(context.Background(), "my-agent-gateway-0", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "stale NotReady pod at old rev should be deleted; got err=%v", err)
}

func TestForceRollStuckPod_LeavesReadyOldRevPodAlone(t *testing.T) {
	ss := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent-gateway", Namespace: "test-agents"},
		Spec: appsv1.StatefulSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"agent-platform.ai/role": "gateway"}},
		},
		Status: appsv1.StatefulSetStatus{
			CurrentRevision: "rev-1",
			UpdateRevision:  "rev-2",
		},
	}
	healthyPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-agent-gateway-0",
			Namespace: "test-agents",
			Labels: map[string]string{
				"agent-platform.ai/role":   "gateway",
				"controller-revision-hash": "rev-1",
			},
		},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}},
		},
	}
	r, client := setupReconciler(t, nil, ss, healthyPod)

	require.NoError(t, r.forceRollStuckPod(context.Background(), "test-agents", "my-agent-gateway"))

	_, err := client.CoreV1().Pods("test-agents").Get(context.Background(), "my-agent-gateway-0", metav1.GetOptions{})
	assert.NoError(t, err, "Ready old-rev pod must not be deleted — let normal rolling-update handle it")
}

func TestForceRollStuckPod_NoopWhenRevisionsMatch(t *testing.T) {
	ss := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent-gateway", Namespace: "test-agents"},
		Spec: appsv1.StatefulSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"agent-platform.ai/role": "gateway"}},
		},
		Status: appsv1.StatefulSetStatus{
			CurrentRevision: "rev-1",
			UpdateRevision:  "rev-1",
		},
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-agent-gateway-0",
			Namespace: "test-agents",
			Labels:    map[string]string{"agent-platform.ai/role": "gateway", "controller-revision-hash": "rev-1"},
		},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionFalse}},
		},
	}
	r, client := setupReconciler(t, nil, ss, pod)

	require.NoError(t, r.forceRollStuckPod(context.Background(), "test-agents", "my-agent-gateway"))

	_, err := client.CoreV1().Pods("test-agents").Get(context.Background(), "my-agent-gateway-0", metav1.GetOptions{})
	assert.NoError(t, err, "no-op required when SS revisions match")
}

func gatewayRevFixture(currentRev, updateRev, podRev string, ready bool) (*appsv1.StatefulSet, *corev1.Pod) {
	labels := map[string]string{"agent-platform.ai/role": "gateway", "agent-platform.ai/pair": "my-agent"}
	ss := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent-gateway", Namespace: "test-agents", UID: "ss-uid"},
		Spec:       appsv1.StatefulSetSpec{Selector: &metav1.LabelSelector{MatchLabels: labels}},
		Status:     appsv1.StatefulSetStatus{CurrentRevision: currentRev, UpdateRevision: updateRev},
	}
	podLabels := map[string]string{"controller-revision-hash": podRev}
	for k, v := range labels {
		podLabels[k] = v
	}
	readyStatus := corev1.ConditionFalse
	if ready {
		readyStatus = corev1.ConditionTrue
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent-gateway-0", Namespace: "test-agents", Labels: podLabels},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: readyStatus}},
		},
	}
	return ss, pod
}

func TestForceRollStuckPod_DeletesNotReadyPodAtIntermediateRev(t *testing.T) {
	ss, stuckPod := gatewayRevFixture("rev-1", "rev-3", "rev-2", false)
	r, client := setupReconciler(t, nil, ss, stuckPod)

	require.NoError(t, r.forceRollStuckPod(context.Background(), "test-agents", "my-agent-gateway"))

	_, err := client.CoreV1().Pods("test-agents").Get(context.Background(), "my-agent-gateway-0", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err),
		"pod wedged on an intermediate revision must be evicted; got err=%v", err)
}

func TestForceRollStuckPod_DeletesStuckPodWhenCorrectionReusedPriorRevision(t *testing.T) {
	ss, stuckPod := gatewayRevFixture("rev-1", "rev-1", "rev-2", false)
	r, client := setupReconciler(t, nil, ss, stuckPod)

	require.NoError(t, r.forceRollStuckPod(context.Background(), "test-agents", "my-agent-gateway"))

	_, err := client.CoreV1().Pods("test-agents").Get(context.Background(), "my-agent-gateway-0", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err),
		"pod off the update revision must be evicted even when current==update; got err=%v", err)
}

func TestForceRollStuckPod_WaitsForObservedGeneration(t *testing.T) {
	ss, stuckPod := gatewayRevFixture("rev-1", "rev-1", "rev-2", false)
	ss.Generation = 2
	ss.Status.ObservedGeneration = 1
	r, client := setupReconciler(t, nil, ss, stuckPod)

	require.NoError(t, r.forceRollStuckPod(context.Background(), "test-agents", "my-agent-gateway"))

	_, err := client.CoreV1().Pods("test-agents").Get(context.Background(), "my-agent-gateway-0", metav1.GetOptions{})
	assert.NoError(t, err, "must not evict against an unobserved target revision")
}

func TestGatewayNotReadyCause(t *testing.T) {
	oomPod := podAtRev("my-agent-gateway-0", "rev-2", false)
	oomPod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name: "envoy",
		State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
			Reason: "OOMKilled", ExitCode: 137,
		}},
	}}

	cases := []struct {
		name       string
		objects    []runtime.Object
		wantReason string
	}{
		{
			name:       "no pod yet",
			objects:    []runtime.Object{rolloutSS("my-agent-gateway", 1, 1, "rev-2")},
			wantReason: "PodNotReady",
		},
		{
			name: "on the target revision, still starting",
			objects: []runtime.Object{
				rolloutSS("my-agent-gateway", 1, 1, "rev-2"),
				podAtRev("my-agent-gateway-0", "rev-2", false),
			},
			wantReason: "PodNotReady",
		},
		{
			name: "wedged on a superseded revision",
			objects: []runtime.Object{
				rolloutSS("my-agent-gateway", 1, 1, "rev-3"),
				podAtRev("my-agent-gateway-0", "rev-2", false),
			},
			wantReason: apiv1.ReasonStuckOnSupersededRevision,
		},
		{
			name: "ready pod on an old revision is an ordinary roll",
			objects: []runtime.Object{
				rolloutSS("my-agent-gateway", 1, 1, "rev-3"),
				podAtRev("my-agent-gateway-0", "rev-2", true),
			},
			wantReason: "PodNotReady",
		},
		{
			name: "statefulset has not observed the newest template",
			objects: []runtime.Object{
				rolloutSS("my-agent-gateway", 2, 1, "rev-2"),
				podAtRev("my-agent-gateway-0", "rev-1", false),
			},
			wantReason: "PodNotReady",
		},
		{
			name: "abnormal termination outranks the revision mismatch",
			objects: []runtime.Object{
				rolloutSS("my-agent-gateway", 1, 1, "rev-3"),
				oomPod,
			},
			wantReason: "OutOfMemory",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, _ := setupReconciler(t, nil, tc.objects...)
			reason, _ := r.gatewayNotReadyCause(context.Background(), "my-agent-gateway")
			assert.Equal(t, tc.wantReason, reason)
		})
	}
}

func TestEnsureLeafSecretOwnerReference_AddsOwnerRef(t *testing.T) {
	agent := agentCR()
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-agent-envoy-tls",
			Namespace: "test-agents",
		},
		Type: corev1.SecretTypeTLS,
	}
	r, client := setupReconciler(t, agent, secret)

	require.NoError(t, r.ensureSecretOwnerReference(context.Background(), EnvoyLeafSecretName("my-agent"), nil, agentOwnerRef(agent)))

	got, err := client.CoreV1().Secrets("test-agents").Get(context.Background(), "my-agent-envoy-tls", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, got.OwnerReferences, 1)
	assert.Equal(t, agent.UID, got.OwnerReferences[0].UID)
	assert.Equal(t, "Agent", got.OwnerReferences[0].Kind)
	assert.Equal(t, agent.Name, got.OwnerReferences[0].Name)
}

func TestEnsureLeafSecretOwnerReference_Idempotent(t *testing.T) {
	agent := agentCR()
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-agent-envoy-tls",
			Namespace: "test-agents",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: apiv1.GroupVersion.String(), Kind: "Agent", Name: agent.Name, UID: agent.UID,
			}},
		},
	}
	r, client := setupReconciler(t, agent, secret)

	require.NoError(t, r.ensureSecretOwnerReference(context.Background(), EnvoyLeafSecretName("my-agent"), nil, agentOwnerRef(agent)))

	got, err := client.CoreV1().Secrets("test-agents").Get(context.Background(), "my-agent-envoy-tls", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, got.OwnerReferences, 1, "must not duplicate the owner ref across reconciles")
}

func TestReconcileOrphanLeafSecrets(t *testing.T) {
	orphan := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "deleted-agent-envoy-tls",
			Namespace: "test-agents",
		},
		Type: corev1.SecretTypeTLS,
	}
	live := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-agent-envoy-tls",
			Namespace: "test-agents",
		},
		Type: corev1.SecretTypeTLS,
	}
	unrelated := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "something-envoy-tls",
			Namespace: "test-agents",
		},
		Type: corev1.SecretTypeOpaque,
	}
	r, client := setupReconciler(t, agentCR(), orphan, live, unrelated)

	r.ReconcileOrphanLeafSecrets(context.Background())

	_, err := client.CoreV1().Secrets("test-agents").Get(context.Background(), orphan.Name, metav1.GetOptions{})
	assert.Error(t, err, "orphan leaf Secret must be deleted")

	_, err = client.CoreV1().Secrets("test-agents").Get(context.Background(), live.Name, metav1.GetOptions{})
	assert.NoError(t, err, "live agent leaf Secret must be retained")

	_, err = client.CoreV1().Secrets("test-agents").Get(context.Background(), unrelated.Name, metav1.GetOptions{})
	assert.NoError(t, err, "non-TLS Secret with similar name must not be touched")
}

func TestEnsureLeafSecretOwnerReference_NoSecretYetIsNoop(t *testing.T) {
	agent := agentCR()
	r, _ := setupReconciler(t, agent)
	assert.NoError(t, r.ensureSecretOwnerReference(context.Background(), EnvoyLeafSecretName("my-agent"), nil, agentOwnerRef(agent)))
}
