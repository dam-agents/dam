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

// authzPolicyListGVR is the schema.GroupVersionResource for List dispatch
// in the dynamic fake client. The fake registry needs a List kind for
// every Resource it might watch; otherwise Update/Get returns NotFound
// even for objects we just Created via the fake.
var authzPolicyListGVR = schema.GroupVersionResource{Group: "security.istio.io", Version: "v1", Resource: "authorizationpolicies"}

// newFakeDynamic returns a dynamic fake that knows the AuthorizationPolicy CRD
// shape the controller writes and the Agent CRD so agents
// can be Get/UpdateStatus'd. `objects` seeds the tracker (unstructured CRs).
func newFakeDynamic(objects ...runtime.Object) *dynfake.FakeDynamicClient {
	scheme := runtime.NewScheme()
	gvrToListKind := map[schema.GroupVersionResource]string{
		authzPolicyListGVR: "AuthorizationPolicyList",
		AgentsGVR:          "AgentList",
	}
	return dynfake.NewSimpleDynamicClientWithCustomListKinds(scheme, gvrToListKind, objects...)
}

// agentCR returns a typed Agent CR. Most tests inherit the default
// activity-less agent (no last-activity annotation → shouldRun fails open to
// running); hibernation tests override Annotations.
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
	// The fake clientset doesn't simulate kube-apiserver's ClusterIP
	// assignment, but the reconciler now requires it on every path
	// (HTTPS_PROXY is IP-direct). Reactor stamps a stable IP onto any
	// ClusterIP-typed Service at Create so reconcile can proceed.
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
			AccessMode:             "ReadWriteMany",
			TerminationGracePeriod: 5,
			IdleTimeout:            config.Duration(time.Hour),
			ContainerSecurityContext: &corev1.SecurityContext{
				Capabilities: &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
			},
		},
		AgentTemplateDefaults: config.AgentTemplateDefaults{
			AgentHome:       "/home/agent",
			ImagePullPolicy: "IfNotPresent",
			StorageSize:     "10Gi",
		},
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

// readyPod is a pod reporting Ready=True, used to drive the readiness
// conditions — the fake has no StatefulSet controller, so tests
// stand pods up directly.
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
	// Both pods Ready → Ready condition True.
	agent := agentCR()
	r, _ := setupReconciler(t, agent, readyPod("my-agent-0"), readyPod("my-agent-gateway-0"))

	require.NoError(t, r.Reconcile(context.Background(), agent))

	st, ok := agentCondition(t, r, "my-agent", apiv1.ConditionReady)
	require.True(t, ok, "Ready condition must be published")
	assert.Equal(t, string(metav1.ConditionTrue), st)
}

func TestReconcile_PendingWhenGatewayNotReady(t *testing.T) {
	// Ready requires BOTH pods — a ready agent with no ready gateway is not
	// routable (no credentialed egress), so Ready=False.
	agent := agentCR()
	r, _ := setupReconciler(t, agent, readyPod("my-agent-0")) // gateway pod absent

	require.NoError(t, r.Reconcile(context.Background(), agent))

	st, _ := agentCondition(t, r, "my-agent", apiv1.ConditionReady)
	assert.Equal(t, string(metav1.ConditionFalse), st)
	agentReady, _ := agentCondition(t, r, "my-agent", apiv1.ConditionAgentPodReady)
	assert.Equal(t, string(metav1.ConditionTrue), agentReady, "agent pod is ready")
	gwReady, _ := agentCondition(t, r, "my-agent", apiv1.ConditionGatewayPodReady)
	assert.Equal(t, string(metav1.ConditionFalse), gwReady, "gateway pod is not ready")
}

// rolloutSS / podAtRev stand in for the StatefulSet controller the fake
// clientset lacks: they seed the same fields real Kubernetes would maintain —
// the StatefulSet's observed generation + latest (update) revision, and the
// pod's controller-revision-hash. podCurrentAndReady reads both live; it keeps
// no revision state of its own.
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
	// The desired revision (ss.Status.UpdateRevision) and the pod's actual
	// revision (controller-revision-hash) are both read live; readiness is true
	// only when they match, the StatefulSet has observed the latest generation,
	// and the pod is Ready. Anything mid-rollout reads as not-ready.
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
	// An api-server-set roll-rev lands on both pod templates so bumping it
	// rolls the pair.
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
	// No roll-rev annotation → no roll-rev on the pod template, so agents that
	// never requested a restart don't churn.
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

	// Agent StatefulSet — replicas=1
	ss, err := client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *ss.Spec.Replicas)

	// Proxy URL is the paired gateway's ClusterIP literal — IP-direct so
	// the egress NP can deny DNS entirely.
	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t, "http://10.96.42.42:10000", envMap["HTTPS_PROXY"])

	// Gateway StatefulSet — also replicas=1
	gws, err := client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent-gateway", metav1.GetOptions{})
	require.NoError(t, err, "gateway StatefulSet must be created alongside the agent")
	assert.Equal(t, int32(1), *gws.Spec.Replicas)

	// Agent Service
	svc, err := client.CoreV1().Services("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, corev1.ClusterIPNone, svc.Spec.ClusterIP)

	// Gateway Service — ClusterIP-typed (not headless) so hostAliases /
	// iptables allow-list have a stable IP to pin.
	gwSvc, err := client.CoreV1().Services("test-agents").Get(ctx, "my-agent-gateway", metav1.GetOptions{})
	require.NoError(t, err, "gateway Service must be created so HTTPS_PROXY DNS resolves")
	assert.NotEqual(t, corev1.ClusterIPNone, gwSvc.Spec.ClusterIP, "gateway Service must not be headless")

	// Per-agent ServiceAccount — kept off-pod via
	// automountServiceAccountToken: false. The agent pod has no SPIFFE
	// identity (ambient opt-out), but the SA still scopes Secret access
	// at the controller level.
	sa, err := client.CoreV1().ServiceAccounts("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err, "per-agent ServiceAccount must be created")
	require.NotNil(t, sa.AutomountServiceAccountToken)
	assert.False(t, *sa.AutomountServiceAccountToken)

	// Per-agent ext-authz Service in the release namespace.
	_, err = client.CoreV1().Services("default").Get(ctx, "platform-extauthz-my-agent", metav1.GetOptions{})
	require.NoError(t, err, "per-agent ext-authz Service must be created")

	// Per-pair agent egress NetworkPolicy — the sole gate on the agent →
	// paired gateway hop. Agent has no ambient enrolment, so NP sees real
	// destination IPs and denies anything that isn't DNS or the paired
	// gateway pod on the Envoy port.
	np, err := client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, "my-agent-agent-egress", metav1.GetOptions{})
	require.NoError(t, err, "per-pair agent egress NetworkPolicy must be created")
	assert.Equal(t, "my-agent", np.Spec.PodSelector.MatchLabels["agent-platform.ai/pair"])
	assert.Equal(t, "agent", np.Spec.PodSelector.MatchLabels["agent-platform.ai/role"])

	// Pod specs use the per-agent SA. On the gateway, this materialises
	// as a SPIFFE workload identity used by the harness + ext-authz
	// AuthorizationPolicies.
	assert.Equal(t, "my-agent", ss.Spec.Template.Spec.ServiceAccountName,
		"agent pod must run as the per-agent SA")
	assert.Equal(t, "my-agent", gws.Spec.Template.Spec.ServiceAccountName,
		"gateway pod must run as the per-agent SA (its SPIFFE principal gates harness + ext-authz)")

	// Status published on the CR subresource: a scaled-up agent with no Ready
	// pods reports Ready=False until the pod-watch pass observes readiness.
	ready, _ := agentCondition(t, r, "my-agent", apiv1.ConditionReady)
	assert.Equal(t, string(metav1.ConditionFalse), ready)
}

func TestReconcile_IdleAgentScalesToZero(t *testing.T) {
	// An idle agent (stale activity, no active session) reconciles to zero
	// replicas — run state is derived from activity, not a stored desiredState
	// The reconciler does not publish readiness for an idle agent;
	// the hibernated status is the idle checker's to write.
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

	// Rendering still succeeded, so Reconciled is published — an idle agent must
	// not keep a stale error condition.
	reconciled, found := agentCondition(t, r, "my-agent", apiv1.ConditionReconciled)
	require.True(t, found, "idle agent must still record the Reconciled condition")
	assert.Equal(t, string(metav1.ConditionTrue), reconciled)
}

func TestReconcile_PreservesHibernation(t *testing.T) {
	// An idle agent the idle checker already scaled to zero must stay at zero
	// across a reconcile: the reconciler scales up only on activity and never
	// force-wakes a hibernated agent.
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
	// The deadlock case: SS template has been updated to rev-2 but the
	// pod is still at rev-1, NotReady (CrashLoopBackOff). Without help,
	// the SS controller refuses to evict a NotReady pod, leaving the
	// rollout stuck. forceRollStuckPod must delete the pod so the SS
	// can recreate it at the new revision.
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
	// On clusters where MaxUnavailableStatefulSet IS enabled, the SS
	// controller can roll past Ready old-rev pods normally. Don't
	// pre-empt that — only intervene when the pod is NotReady.
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
	// No pending update → no rollout to unstick. Even if a pod is NotReady
	// (e.g. transient liveness flap), don't churn it; only deadlocks
	// caused by stale revisions are our concern.
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

func TestReconcile_PatchesGatewayUpdateStrategyOnExistingStatefulSet(t *testing.T) {
	// applyStatefulSet must propagate UpdateStrategy to existing StatefulSets,
	// not just newly-created ones. Without this, updating the controller
	// to set maxUnavailable: 1 on the gateway only takes effect for
	// fresh installs — already-running pairs keep the default rolling
	// strategy and stay stuck behind CrashLoop pods on rev transitions.
	agent := agentCR()
	// An existing gateway StatefulSet at the default (empty) update
	// strategy, simulating a pre-fix install.
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
	// Second reconcile should not error
	err = r.Reconcile(context.Background(), agent)
	require.NoError(t, err)
}

func TestDelete_CleansPVCs(t *testing.T) {
	agent := agentCR()
	// Pre-create PVCs that would have been created by the StatefulSet controller
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "home-agent-my-agent-0",
			Namespace: "test-agents",
			Labels:    map[string]string{LabelAgent: "my-agent"},
		},
	}
	r, client := setupReconciler(t, agent, pvc)

	// Verify PVC exists before deletion
	ctx := context.Background()
	pvcs, err := client.CoreV1().PersistentVolumeClaims("test-agents").List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=my-agent",
	})
	require.NoError(t, err)
	assert.Len(t, pvcs.Items, 1)

	// Delete agent — should clean up PVCs
	r.Delete(ctx, "my-agent")

	pvcs, err = client.CoreV1().PersistentVolumeClaims("test-agents").List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=my-agent",
	})
	require.NoError(t, err)
	assert.Empty(t, pvcs.Items)
}

func TestReconcileOrphanPVCs(t *testing.T) {
	// orphan: PVC labeled for an agent whose Agent CR is gone
	orphan := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "home-agent-deleted-agent-0",
			Namespace: "test-agents",
			Labels:    map[string]string{LabelAgent: "deleted-agent"},
		},
	}
	// live: PVC labeled for an agent that still has an Agent CR
	live := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "home-agent-my-agent-0",
			Namespace: "test-agents",
			Labels:    map[string]string{LabelAgent: "my-agent"},
		},
	}
	r, client := setupReconciler(t, agentCR(), orphan, live) // live agent = "my-agent"

	r.ReconcileOrphanPVCs(context.Background())

	// orphan removed
	_, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), orphan.Name, metav1.GetOptions{})
	assert.Error(t, err, "orphan PVC should be deleted")

	// live retained
	_, err = client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), live.Name, metav1.GetOptions{})
	assert.NoError(t, err, "live agent PVC must be retained")
}

func int32Ptr(i int32) *int32 { return &i }

// Issue: when an agent is deleted, the cert-manager-produced envoy leaf
// TLS Secret must be cascade-deleted. cert-manager doesn't set an
// OwnerReference on that Secret by default, so the controller patches one
// pointing back at the Agent CR.

func TestEnsureLeafSecretOwnerReference_AddsOwnerRef(t *testing.T) {
	agent := agentCR()
	// Seed the cluster with a Secret as if cert-manager had already produced
	// it but without an OwnerReference (default cert-manager behaviour).
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
	// orphan: leaf Secret whose Agent CR is gone — must be reaped.
	orphan := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "deleted-agent-envoy-tls",
			Namespace: "test-agents",
		},
		Type: corev1.SecretTypeTLS,
	}
	// live: leaf Secret whose Agent CR still exists — must be kept.
	live := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-agent-envoy-tls",
			Namespace: "test-agents",
		},
		Type: corev1.SecretTypeTLS,
	}
	// unrelated: a Secret with a similar suffix but wrong type — must not be touched.
	unrelated := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "something-envoy-tls",
			Namespace: "test-agents",
		},
		Type: corev1.SecretTypeOpaque,
	}
	r, client := setupReconciler(t, agentCR(), orphan, live, unrelated) // live agent = "my-agent"

	r.ReconcileOrphanLeafSecrets(context.Background())

	_, err := client.CoreV1().Secrets("test-agents").Get(context.Background(), orphan.Name, metav1.GetOptions{})
	assert.Error(t, err, "orphan leaf Secret must be deleted")

	_, err = client.CoreV1().Secrets("test-agents").Get(context.Background(), live.Name, metav1.GetOptions{})
	assert.NoError(t, err, "live agent leaf Secret must be retained")

	_, err = client.CoreV1().Secrets("test-agents").Get(context.Background(), unrelated.Name, metav1.GetOptions{})
	assert.NoError(t, err, "non-TLS Secret with similar name must not be touched")
}

func TestEnsureLeafSecretOwnerReference_NoSecretYetIsNoop(t *testing.T) {
	// First reconcile arrives before cert-manager has issued the Secret —
	// must not error; the next reconcile will patch the owner ref.
	agent := agentCR()
	r, _ := setupReconciler(t, agent)
	assert.NoError(t, r.ensureLeafSecretOwnerReference(context.Background(), "my-agent", agentOwnerRef(agent)))
}

// --- Warm-pool claim path (#692) ---

func enableWarmPool(r *AgentReconciler, sizes ...config.WarmPoolSize) {
	// AccessMode is inherited from AgentBase (set by setupReconciler), not the
	// pool config.
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
	agent := agentCR() // testAgent persists /home/agent at the 10Gi chart default
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
	r, client := setupReconciler(t, agent) // no spares seeded
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
	require.NoError(t, r.Reconcile(context.Background(), agent)) // STS now exists

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
	// The first candidate always conflicts (a concurrent writer); claimSpare
	// must move on to the next available spare rather than fail the reconcile.
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

// seedAgentSTSWithClaim stands up a live agent StatefulSet whose pod template
// already mounts a workspace PVC by claimName (as applyPoolClaims would render
// it), so resolveWorkspaceClaims can be exercised against an existing STS.
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
	// The claimed spare PVC is gone (deleted out-of-band), but the live STS
	// still mounts it by name. Reconstruction must reproduce that claim from the
	// STS — not from PVC labels — so the rendered template stays valid (keeps
	// referencing the missing PVC, a recoverable state) instead of degrading to
	// a volumeMount with no backing volume.
	agent := agentCR() // persists /home/agent
	r, client := setupReconciler(t, agent)
	enableWarmPool(r, config.WarmPoolSize{Size: "10Gi", Target: 1})
	seedAgentSTSWithClaim(t, client, "my-agent", "home-agent", "platform-pool-gone")

	claims, err := r.resolveWorkspaceClaims(context.Background(), agent, &agent.Spec)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"home-agent": "platform-pool-gone"}, claims)
}

func TestResolveWorkspaceClaims_DropsClaimForRemovedMount(t *testing.T) {
	// The live STS still mounts a "cache" PVC by name, but the spec no longer
	// persists /cache. The claim must be dropped so applyPoolClaims doesn't add
	// a volume that no container mounts.
	agent := agentCR() // persists /home/agent only — no /cache
	r, client := setupReconciler(t, agent)
	enableWarmPool(r, config.WarmPoolSize{Size: "10Gi", Target: 1})
	seedAgentSTSWithClaim(t, client, "my-agent", "cache", "platform-pool-stale")

	claims, err := r.resolveWorkspaceClaims(context.Background(), agent, &agent.Spec)
	require.NoError(t, err)
	assert.NotContains(t, claims, "cache", "a claim for a mount no longer in the spec is dropped")
}

func TestReconcileOrphanPVCs_LeavesPoolSparesAlone(t *testing.T) {
	agent := agentCR() // "my-agent" exists in the dynamic fake
	r, client := setupReconciler(t, agent,
		availableSpare("platform-pool-aaaaaa", "10Gi", corev1.ClaimBound, time.Now()), // unclaimed: no agent label
		&corev1.PersistentVolumeClaim{ // orphan: agent CR long gone
			ObjectMeta: metav1.ObjectMeta{Name: "home-agent-ghost-0", Namespace: "test-agents", Labels: map[string]string{LabelAgent: "ghost"}},
		},
	)

	r.ReconcileOrphanPVCs(context.Background())

	_, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "platform-pool-aaaaaa", metav1.GetOptions{})
	assert.NoError(t, err, "unclaimed spare carries no agent label → the sweep never sees it")
	_, err = client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "home-agent-ghost-0", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "orphan PVC for a missing agent is reclaimed")
}
