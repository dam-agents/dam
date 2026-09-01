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
	dynfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
)

var authzPolicyListGVR = schema.GroupVersionResource{Group: "security.istio.io", Version: "v1", Resource: "authorizationpolicies"}

func newFakeDynamic(objects ...runtime.Object) *dynfake.FakeDynamicClient {
	scheme := runtime.NewScheme()
	gvrToListKind := map[schema.GroupVersionResource]string{
		authzPolicyListGVR: "AuthorizationPolicyList",
		AgentsGVR:          "AgentList",
		UserBudgetsGVR:     "UserBudgetList",
		VirtualMachinesGVR: "VirtualMachineList",
	}
	return dynfake.NewSimpleDynamicClientWithCustomListKinds(scheme, gvrToListKind, objects...)
}

func agentCR() *apiv1.Agent {
	return &apiv1.Agent{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-agent", Namespace: "test-agents", UID: "agent-uid",
		},
		Spec: *testAgent,
	}
}

func setupReconciler(t *testing.T, agent *apiv1.Agent, objects ...runtime.Object) (*AgentReconciler, *fake.Clientset) {
	t.Helper()
	client := fake.NewSimpleClientset(objects...)
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
		EnvoyImage:        "mirror.gcr.io/envoyproxy/envoy:distroless-v1.37.2",
		EnvoyPort:         10000,
		IstioTrustDomain:  "cluster.local",
		IstioWaypointName: "apiserver-waypoint",
		AgentBase: config.AgentBase{
			TerminationGracePeriod: 5,
			IdleTimeout:            config.Duration(time.Hour),
			ContainerSecurityContext: &corev1.SecurityContext{
				Capabilities: &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
			},
		},
		AgentTemplateDefaults: config.AgentTemplateDefaults{
			ImagePullPolicy: "IfNotPresent",
			StorageSize:     "10Gi",
		},
		DefaultUserCPUBudget:    resource.MustParse("4"),
		DefaultUserMemoryBudget: resource.MustParse("8Gi"),
		RequestsFraction:        0.5,
		RequestsMinCPU:          resource.MustParse("100m"),
		RequestsMinMemory:       resource.MustParse("128Mi"),
		LegacyAgentCPULimit:     resource.MustParse("1"),
		LegacyAgentMemoryLimit:  resource.MustParse("2Gi"),
	}
	var dynObjs []runtime.Object
	if agent != nil {
		u, err := agentToUnstructured(agent)
		require.NoError(t, err)
		dynObjs = append(dynObjs, u)
	}
	r := NewAgentReconciler(client, cfg).WithDynamicClient(newFakeDynamic(dynObjs...))
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

func TestReconcile_RunningWhenBothPodsReady(t *testing.T) {
	agent := agentCR()
	r, _ := setupReconciler(t, agent, readyPod("my-agent-0"), readyPod("my-agent-gateway-0"))

	require.NoError(t, r.Reconcile(context.Background(), agent))

	st, ok := agentCondition(t, r, "my-agent", apiv1.ConditionReady)
	require.True(t, ok, "Ready condition must be published")
	assert.Equal(t, string(metav1.ConditionTrue), st)
}

func TestReconcile_PendingWhenGatewayNotReady(t *testing.T) {
	agent := agentCR()
	r, _ := setupReconciler(t, agent, readyPod("my-agent-0"))

	require.NoError(t, r.Reconcile(context.Background(), agent))

	st, _ := agentCondition(t, r, "my-agent", apiv1.ConditionReady)
	assert.Equal(t, string(metav1.ConditionFalse), st)
	agentReady, _ := agentCondition(t, r, "my-agent", apiv1.ConditionAgentPodReady)
	assert.Equal(t, string(metav1.ConditionTrue), agentReady, "agent pod is ready")
	gwReady, _ := agentCondition(t, r, "my-agent", apiv1.ConditionGatewayPodReady)
	assert.Equal(t, string(metav1.ConditionFalse), gwReady, "gateway pod is not ready")
}

func rolloutSS(name string, generation, observedGen int64, updateRev string) *appsv1.StatefulSet {
	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "test-agents", Generation: generation},
		Spec:       appsv1.StatefulSetSpec{Replicas: int32Ptr(1)},
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

func TestReconcile_StampsRollRev(t *testing.T) {
	agent := agentCR()
	agent.Annotations = map[string]string{annRollRev: "v1"}
	r, client := setupReconciler(t, agent)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	ctx := context.Background()
	ss, err := client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "v1", ss.Spec.Template.Annotations[annRollRev], "agent pod template carries roll-rev")
	gws, err := client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent-gateway", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "v1", gws.Spec.Template.Annotations[annRollRev], "gateway pod template carries roll-rev")
}

func TestReconcile_NoRollRevWhenUnset(t *testing.T) {
	agent := agentCR()
	r, client := setupReconciler(t, agent)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	ss, _ := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	_, present := ss.Spec.Template.Annotations[annRollRev]
	assert.False(t, present, "roll-rev absent when the agent sets none")
}

func TestReconcile_CreateResources(t *testing.T) {
	agent := agentCR()
	r, client := setupReconciler(t, agent)

	err := r.Reconcile(context.Background(), agent)
	require.NoError(t, err)

	ctx := context.Background()

	ss, err := client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *ss.Spec.Replicas)

	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t, "http://10.96.42.42:10000", envMap["HTTPS_PROXY"])

	gws, err := client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent-gateway", metav1.GetOptions{})
	require.NoError(t, err, "gateway StatefulSet must be created alongside the agent")
	assert.Equal(t, int32(1), *gws.Spec.Replicas)

	svc, err := client.CoreV1().Services("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, corev1.ClusterIPNone, svc.Spec.ClusterIP)

	gwSvc, err := client.CoreV1().Services("test-agents").Get(ctx, "my-agent-gateway", metav1.GetOptions{})
	require.NoError(t, err, "gateway Service must be created so HTTPS_PROXY DNS resolves")
	assert.NotEqual(t, corev1.ClusterIPNone, gwSvc.Spec.ClusterIP, "gateway Service must not be headless")

	sa, err := client.CoreV1().ServiceAccounts("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err, "per-agent ServiceAccount must be created")
	require.NotNil(t, sa.AutomountServiceAccountToken)
	assert.False(t, *sa.AutomountServiceAccountToken)

	_, err = client.CoreV1().Services("default").Get(ctx, "platform-extauthz-my-agent", metav1.GetOptions{})
	require.NoError(t, err, "per-agent ext-authz Service must be created")

	np, err := client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, "my-agent-agent-egress", metav1.GetOptions{})
	require.NoError(t, err, "per-pair agent egress NetworkPolicy must be created")
	assert.Equal(t, "my-agent", np.Spec.PodSelector.MatchLabels["agent-platform.ai/pair"])
	assert.Equal(t, "agent", np.Spec.PodSelector.MatchLabels["agent-platform.ai/role"])

	assert.Equal(t, "my-agent", ss.Spec.Template.Spec.ServiceAccountName,
		"agent pod must run as the per-agent SA")
	assert.Equal(t, "my-agent", gws.Spec.Template.Spec.ServiceAccountName,
		"gateway pod must run as the per-agent SA (its SPIFFE principal gates harness + ext-authz)")

	ready, _ := agentCondition(t, r, "my-agent", apiv1.ConditionReady)
	assert.Equal(t, string(metav1.ConditionFalse), ready)
}

func TestReconcile_IdleAgentScalesToZero(t *testing.T) {
	agent := agentCR()
	agent.Annotations = map[string]string{
		annLastActivity: time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339),
	}
	r, client := setupReconciler(t, agent)

	err := r.Reconcile(context.Background(), agent)
	require.NoError(t, err)

	ss, _ := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	assert.Equal(t, int32(0), *ss.Spec.Replicas, "idle agent created scaled to zero")
	gws, _ := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-agent-gateway", metav1.GetOptions{})
	assert.Equal(t, int32(0), *gws.Spec.Replicas, "gateway scaled to zero alongside the agent")

	_, found := agentCondition(t, r, "my-agent", apiv1.ConditionReady)
	assert.False(t, found,
		"reconciler must not publish readiness for an idle agent; that is the idle checker's job")

	reconciled, found := agentCondition(t, r, "my-agent", apiv1.ConditionReconciled)
	require.True(t, found, "idle agent must still record the Reconciled condition")
	assert.Equal(t, string(metav1.ConditionTrue), reconciled)
}

func TestReconcile_PreservesHibernation(t *testing.T) {
	agent := agentCR()
	agent.Annotations = map[string]string{
		annLastActivity: time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339),
	}
	existingAgent := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent", Namespace: "test-agents"},
		Spec:       appsv1.StatefulSetSpec{Replicas: int32Ptr(0)},
	}
	existingGW := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent-gateway", Namespace: "test-agents"},
		Spec:       appsv1.StatefulSetSpec{Replicas: int32Ptr(0)},
	}
	r, client := setupReconciler(t, agent, existingAgent, existingGW)

	err := r.Reconcile(context.Background(), agent)
	require.NoError(t, err)

	ss, _ := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	assert.Equal(t, int32(0), *ss.Spec.Replicas, "idle agent stays hibernated across reconcile")
	gws, _ := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-agent-gateway", metav1.GetOptions{})
	assert.Equal(t, int32(0), *gws.Spec.Replicas, "gateway stays hibernated alongside the agent")
}

func TestReconcile_UpdateReplicas(t *testing.T) {
	agent := agentCR()
	existingSS := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent", Namespace: "test-agents"},
		Spec:       appsv1.StatefulSetSpec{Replicas: int32Ptr(0)},
	}
	r, client := setupReconciler(t, agent, existingSS)

	err := r.Reconcile(context.Background(), agent)
	require.NoError(t, err)

	ss, _ := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	assert.Equal(t, int32(1), *ss.Spec.Replicas)
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

func TestReconcile_PatchesGatewayUpdateStrategyOnExistingStatefulSet(t *testing.T) {
	agent := agentCR()
	existingGateway := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent-gateway", Namespace: "test-agents"},
		Spec:       appsv1.StatefulSetSpec{Replicas: int32Ptr(1)},
	}
	r, client := setupReconciler(t, agent, existingGateway)

	err := r.Reconcile(context.Background(), agent)
	require.NoError(t, err)

	got, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-agent-gateway", metav1.GetOptions{})
	require.NoError(t, err)
	require.NotNil(t, got.Spec.UpdateStrategy.RollingUpdate, "rolling update strategy must be patched onto existing StatefulSets")
	require.NotNil(t, got.Spec.UpdateStrategy.RollingUpdate.MaxUnavailable)
	assert.Equal(t, "1", got.Spec.UpdateStrategy.RollingUpdate.MaxUnavailable.String())
}

func TestReconcile_Idempotent(t *testing.T) {
	agent := agentCR()
	r, _ := setupReconciler(t, agent)

	err := r.Reconcile(context.Background(), agent)
	require.NoError(t, err)
	err = r.Reconcile(context.Background(), agent)
	require.NoError(t, err)
}

func TestDelete_CleansPVCs(t *testing.T) {
	agent := agentCR()
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "home-agent-my-agent-0",
			Namespace: "test-agents",
			Labels:    map[string]string{LabelAgent: "my-agent"},
		},
	}
	r, client := setupReconciler(t, agent, pvc)

	ctx := context.Background()
	pvcs, err := client.CoreV1().PersistentVolumeClaims("test-agents").List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=my-agent",
	})
	require.NoError(t, err)
	assert.Len(t, pvcs.Items, 1)

	r.Delete(ctx, "my-agent")

	pvcs, err = client.CoreV1().PersistentVolumeClaims("test-agents").List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=my-agent",
	})
	require.NoError(t, err)
	assert.Empty(t, pvcs.Items)
}

func TestReconcileOrphanPVCs(t *testing.T) {
	orphan := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "home-agent-deleted-agent-0",
			Namespace: "test-agents",
			Labels:    map[string]string{LabelAgent: "deleted-agent"},
		},
	}
	live := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "home-agent-my-agent-0",
			Namespace: "test-agents",
			Labels:    map[string]string{LabelAgent: "my-agent"},
		},
	}
	r, client := setupReconciler(t, agentCR(), orphan, live)

	r.ReconcileOrphanPVCs(context.Background())

	_, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), orphan.Name, metav1.GetOptions{})
	assert.Error(t, err, "orphan PVC should be deleted")

	_, err = client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), live.Name, metav1.GetOptions{})
	assert.NoError(t, err, "live agent PVC must be retained")
}

func int32Ptr(i int32) *int32 { return &i }

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

	require.NoError(t, r.ensureLeafSecretOwnerReference(context.Background(), "my-agent", agentOwnerRef(agent)))

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

	require.NoError(t, r.ensureLeafSecretOwnerReference(context.Background(), "my-agent", agentOwnerRef(agent)))

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
	assert.NoError(t, r.ensureLeafSecretOwnerReference(context.Background(), "my-agent", agentOwnerRef(agent)))
}

func enableWarmPool(r *AgentReconciler, sizes ...config.WarmPoolSize) {
	r.config.WarmPool = config.WarmPool{
		Enabled:      true,
		StorageClass: "platform-rwx-immediate",
		Sizes:        sizes,
	}
}

func getAgentSTS(t *testing.T, client *fake.Clientset, name string) *appsv1.StatefulSet {
	t.Helper()
	ss, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	return ss
}

func TestReconcile_ClaimsWarmPoolSpare(t *testing.T) {
	agent := agentCR()
	r, client := setupReconciler(t, agent, availableSpare("platform-pool-aaaaaa", "10Gi", corev1.ClaimBound, time.Now()))
	enableWarmPool(r, config.WarmPoolSize{Size: "10Gi", Target: 1})

	require.NoError(t, r.Reconcile(context.Background(), agent))

	claimed, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "platform-pool-aaaaaa", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-agent", claimed.Labels[LabelAgent], "spare relabeled to the agent")
	assert.Equal(t, "home-agent", claimed.Labels[LabelMount], "records the mount it backs")
	assert.NotContains(t, claimed.Labels, LabelPoolAvailable, "available marker removed")

	ss := getAgentSTS(t, client, "my-agent")
	assert.False(t, hasVCT(ss, "home-agent"), "claimed mount mounted by name, not via volumeClaimTemplate")
	claim, ok := podClaimName(ss, "home-agent")
	require.True(t, ok)
	assert.Equal(t, "platform-pool-aaaaaa", claim)
}

func TestReconcile_FallsBackWhenPoolEmpty(t *testing.T) {
	agent := agentCR()
	r, client := setupReconciler(t, agent)
	enableWarmPool(r, config.WarmPoolSize{Size: "10Gi", Target: 1})

	require.NoError(t, r.Reconcile(context.Background(), agent))

	ss := getAgentSTS(t, client, "my-agent")
	assert.True(t, hasVCT(ss, "home-agent"), "empty pool → dynamic provisioning via volumeClaimTemplate")
	_, ok := podClaimName(ss, "home-agent")
	assert.False(t, ok)
}

func TestReconcile_DoesNotDoubleClaimOnReReconcile(t *testing.T) {
	agent := agentCR()
	r, client := setupReconciler(t, agent,
		availableSpare("platform-pool-aaaaaa", "10Gi", corev1.ClaimBound, time.Now()),
		availableSpare("platform-pool-bbbbbb", "10Gi", corev1.ClaimBound, time.Now()),
	)
	enableWarmPool(r, config.WarmPoolSize{Size: "10Gi", Target: 2})

	require.NoError(t, r.Reconcile(context.Background(), agent))
	require.NoError(t, r.Reconcile(context.Background(), agent))

	claimed, err := client.CoreV1().PersistentVolumeClaims("test-agents").List(context.Background(), metav1.ListOptions{LabelSelector: LabelAgent + "=my-agent"})
	require.NoError(t, err)
	assert.Len(t, claimed.Items, 1, "re-reconcile reuses the first claim, never grabs a second spare")
}

func TestReconcile_ClaimRetriesOnConflict(t *testing.T) {
	agent := agentCR()
	r, client := setupReconciler(t, agent,
		availableSpare("platform-pool-aaaaaa", "10Gi", corev1.ClaimBound, time.Now()),
		availableSpare("platform-pool-bbbbbb", "10Gi", corev1.ClaimBound, time.Now()),
	)
	enableWarmPool(r, config.WarmPoolSize{Size: "10Gi", Target: 2})
	client.PrependReactor("update", "persistentvolumeclaims", func(action k8stesting.Action) (bool, runtime.Object, error) {
		pvc := action.(k8stesting.UpdateAction).GetObject().(*corev1.PersistentVolumeClaim)
		if pvc.Name == "platform-pool-aaaaaa" {
			return true, nil, errors.NewConflict(schema.GroupResource{Resource: "persistentvolumeclaims"}, pvc.Name, fmt.Errorf("conflict"))
		}
		return false, pvc, nil
	})

	require.NoError(t, r.Reconcile(context.Background(), agent))

	bbbbbb, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "platform-pool-bbbbbb", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-agent", bbbbbb.Labels[LabelAgent], "second spare claimed after the first conflicts")
	aaaaaa, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "platform-pool-aaaaaa", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "true", aaaaaa.Labels[LabelPoolAvailable], "conflicted spare stays available")
}

func seedAgentSTSWithClaim(t *testing.T, client *fake.Clientset, name, mount, pvc string) {
	t.Helper()
	ss := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "test-agents"},
		Spec: appsv1.StatefulSetSpec{
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Volumes: []corev1.Volume{
						{Name: mount, VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: pvc}}},
						{Name: "ca-cert", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}},
					},
				},
			},
		},
	}
	_, err := client.AppsV1().StatefulSets("test-agents").Create(context.Background(), ss, metav1.CreateOptions{})
	require.NoError(t, err)
}

func TestResolveWorkspaceClaims_ReconstructsFromExistingSTS(t *testing.T) {
	agent := agentCR()
	r, client := setupReconciler(t, agent)
	enableWarmPool(r, config.WarmPoolSize{Size: "10Gi", Target: 1})
	seedAgentSTSWithClaim(t, client, "my-agent", "home-agent", "platform-pool-gone")

	claims, err := r.resolveWorkspaceClaims(context.Background(), agent, &agent.Spec)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"home-agent": "platform-pool-gone"}, claims)
}

func TestResolveWorkspaceClaims_DropsClaimForRemovedMount(t *testing.T) {
	agent := agentCR()
	r, client := setupReconciler(t, agent)
	enableWarmPool(r, config.WarmPoolSize{Size: "10Gi", Target: 1})
	seedAgentSTSWithClaim(t, client, "my-agent", "cache", "platform-pool-stale")

	claims, err := r.resolveWorkspaceClaims(context.Background(), agent, &agent.Spec)
	require.NoError(t, err)
	assert.NotContains(t, claims, "cache", "a claim for a mount no longer in the spec is dropped")
}

func TestReconcileOrphanPVCs_LeavesPoolSparesAlone(t *testing.T) {
	agent := agentCR()
	r, client := setupReconciler(t, agent,
		availableSpare("platform-pool-aaaaaa", "10Gi", corev1.ClaimBound, time.Now()),
		&corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{Name: "home-agent-ghost-0", Namespace: "test-agents", Labels: map[string]string{LabelAgent: "ghost"}},
		},
	)

	r.ReconcileOrphanPVCs(context.Background())

	_, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "platform-pool-aaaaaa", metav1.GetOptions{})
	assert.NoError(t, err, "unclaimed spare carries no agent label → the sweep never sees it")
	_, err = client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "home-agent-ghost-0", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "orphan PVC for a missing agent is reclaimed")
}
