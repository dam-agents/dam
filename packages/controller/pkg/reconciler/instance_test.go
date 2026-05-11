package reconciler

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// authzPolicyListGVR is the schema.GroupVersionResource for List dispatch
// in the dynamic fake client. The fake registry needs a List kind for
// every Resource it might watch; otherwise Update/Get returns NotFound
// even for objects we just Created via the fake.
var authzPolicyListGVR = schema.GroupVersionResource{Group: "security.istio.io", Version: "v1", Resource: "authorizationpolicies"}

// newFakeDynamic returns a dynamic fake that knows about the
// AuthorizationPolicy CRD shape the controller writes (ADR-041). Tests
// that exercise Reconcile() rely on this so the per-instance policies
// can be Created/Updated through the fake.
func newFakeDynamic() *dynfake.FakeDynamicClient {
	scheme := runtime.NewScheme()
	gvrToListKind := map[schema.GroupVersionResource]string{
		authzPolicyListGVR: "AuthorizationPolicyList",
	}
	return dynfake.NewSimpleDynamicClientWithCustomListKinds(scheme, gvrToListKind)
}

func setupReconciler(t *testing.T, agents map[string]*corev1.ConfigMap, objects ...runtime.Object) (*InstanceReconciler, *fake.Clientset) {
	t.Helper()
	client := fake.NewSimpleClientset(objects...)
	cfg := &config.Config{
		Namespace:         "test-agents",
		ReleaseNamespace:  "default",
		ReleaseName:       "platform",
		HarnessServerPort: 4001,
		EnvoyImage:        "envoyproxy/envoy:distroless-v1.37.2",
		EnvoyPort:         10000,
		IstioTrustDomain:  "cluster.local",
		IstioWaypointName: "apiserver-waypoint",
	}
	getter := &fakeGetter{cms: agents}
	r := NewInstanceReconciler(client, cfg, NewAgentResolver(getter)).WithDynamicClient(newFakeDynamic())
	return r, client
}

func agentCM() *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "claude-code", Namespace: "test-agents", UID: "agent-uid",
			Labels: map[string]string{"agent-platform.ai/type": "agent"},
		},
		Data: map[string]string{"spec.yaml": fixtureAgentYAML},
	}
}

func instanceCM(desiredState string) *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-instance", Namespace: "test-agents", UID: "uid-1",
			Labels: map[string]string{
				"agent-platform.ai/type":  "agent-instance",
				"agent-platform.ai/agent": "claude-code",
			},
		},
		Data: map[string]string{
			"spec.yaml": fmt.Sprintf("version: agent-platform.ai/v1\ndesiredState: %s\nagentId: claude-code\n", desiredState),
		},
	}
}

func TestReconcile_CreateResources(t *testing.T) {
	cm := instanceCM("running")
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)

	ctx := context.Background()

	// Agent StatefulSet — replicas=1
	ss, err := client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *ss.Spec.Replicas)

	// Proxy URL targets the paired gateway Service (ADR-038).
	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t, "http://my-instance-gateway:10000", envMap["HTTPS_PROXY"])

	// Gateway StatefulSet — also replicas=1
	gws, err := client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-instance-gateway", metav1.GetOptions{})
	require.NoError(t, err, "gateway StatefulSet must be created alongside the agent")
	assert.Equal(t, int32(1), *gws.Spec.Replicas)

	// Agent Service
	svc, err := client.CoreV1().Services("test-agents").Get(ctx, "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, corev1.ClusterIPNone, svc.Spec.ClusterIP)

	// Gateway Service
	gwSvc, err := client.CoreV1().Services("test-agents").Get(ctx, "my-instance-gateway", metav1.GetOptions{})
	require.NoError(t, err, "gateway Service must be created so HTTPS_PROXY DNS resolves")
	assert.Equal(t, corev1.ClusterIPNone, gwSvc.Spec.ClusterIP)

	// ADR-041: pair-key NetworkPolicies are gone — pair isolation is now
	// enforced by per-instance Istio AuthorizationPolicies. Coverage for
	// the new resources lives in service_account_test.go (per-instance SA)
	// and authorization_policy_test.go.

	// Per-instance ServiceAccount (ADR-041)
	sa, err := client.CoreV1().ServiceAccounts("test-agents").Get(ctx, "my-instance", metav1.GetOptions{})
	require.NoError(t, err, "per-instance ServiceAccount must be created")
	require.NotNil(t, sa.AutomountServiceAccountToken)
	assert.False(t, *sa.AutomountServiceAccountToken)

	// Per-instance ext-authz Service in the release namespace (ADR-041)
	_, err = client.CoreV1().Services("default").Get(ctx, "platform-extauthz-my-instance", metav1.GetOptions{})
	require.NoError(t, err, "per-instance ext-authz Service must be created")

	// ADR-041: per-pair agent egress NetworkPolicy. AuthorizationPolicy
	// only gates ingress; this closes the symmetric egress hole at the
	// kernel layer so an agent can't bypass HTTPS_PROXY.
	np, err := client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, "my-instance-agent-egress", metav1.GetOptions{})
	require.NoError(t, err, "per-pair agent egress NetworkPolicy must be created")
	assert.Equal(t, "my-instance", np.Spec.PodSelector.MatchLabels["agent-platform.ai/pair"])
	assert.Equal(t, "agent", np.Spec.PodSelector.MatchLabels["agent-platform.ai/role"])

	// Pod specs use the per-instance SA (ADR-041)
	assert.Equal(t, "my-instance", ss.Spec.Template.Spec.ServiceAccountName,
		"agent pod must run as the per-instance SA so SPIFFE peer principal == URL :id")
	assert.Equal(t, "my-instance", gws.Spec.Template.Spec.ServiceAccountName,
		"gateway pod must run as the per-instance SA")

	// Status written
	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(ctx, "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "currentState: running")
}

func TestReconcile_Hibernate(t *testing.T) {
	cm := instanceCM("hibernated")
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)

	ss, _ := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Equal(t, int32(0), *ss.Spec.Replicas)

	// Gateway scales with the agent — both at 0 when hibernated.
	gws, _ := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-instance-gateway", metav1.GetOptions{})
	assert.Equal(t, int32(0), *gws.Spec.Replicas, "gateway must hibernate alongside the agent")

	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "currentState: hibernated")
}

func TestReconcile_UpdateReplicas(t *testing.T) {
	cm := instanceCM("running")
	existingSS := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-instance", Namespace: "test-agents"},
		Spec:       appsv1.StatefulSetSpec{Replicas: int32Ptr(0)},
	}
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm, existingSS,
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)

	ss, _ := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Equal(t, int32(1), *ss.Spec.Replicas)
}

func TestForceRollStuckPod_DeletesNotReadyPodAtOldRev(t *testing.T) {
	// The deadlock case: SS template has been updated to rev-2 but the
	// pod is still at rev-1, NotReady (CrashLoopBackOff). Without help,
	// the SS controller refuses to evict a NotReady pod, leaving the
	// rollout stuck. forceRollStuckPod must delete the pod so the SS
	// can recreate it at the new revision.
	ss := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-instance-gateway", Namespace: "test-agents", UID: "ss-uid"},
		Spec: appsv1.StatefulSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"agent-platform.ai/role": "gateway", "agent-platform.ai/pair": "my-instance"}},
		},
		Status: appsv1.StatefulSetStatus{
			CurrentRevision: "rev-1",
			UpdateRevision:  "rev-2",
		},
	}
	stalePod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-instance-gateway-0",
			Namespace: "test-agents",
			Labels: map[string]string{
				"agent-platform.ai/role":   "gateway",
				"agent-platform.ai/pair":   "my-instance",
				"controller-revision-hash": "rev-1",
			},
		},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionFalse}},
		},
	}
	r, client := setupReconciler(t, nil, ss, stalePod)

	require.NoError(t, r.forceRollStuckPod(context.Background(), "test-agents", "my-instance-gateway"))

	_, err := client.CoreV1().Pods("test-agents").Get(context.Background(), "my-instance-gateway-0", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "stale NotReady pod at old rev should be deleted; got err=%v", err)
}

func TestForceRollStuckPod_LeavesReadyOldRevPodAlone(t *testing.T) {
	// On clusters where MaxUnavailableStatefulSet IS enabled, the SS
	// controller can roll past Ready old-rev pods normally. Don't
	// pre-empt that — only intervene when the pod is NotReady.
	ss := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-instance-gateway", Namespace: "test-agents"},
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
			Name:      "my-instance-gateway-0",
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

	require.NoError(t, r.forceRollStuckPod(context.Background(), "test-agents", "my-instance-gateway"))

	_, err := client.CoreV1().Pods("test-agents").Get(context.Background(), "my-instance-gateway-0", metav1.GetOptions{})
	assert.NoError(t, err, "Ready old-rev pod must not be deleted — let normal rolling-update handle it")
}

func TestForceRollStuckPod_NoopWhenRevisionsMatch(t *testing.T) {
	// No pending update → no rollout to unstick. Even if a pod is NotReady
	// (e.g. transient liveness flap), don't churn it; only deadlocks
	// caused by stale revisions are our concern.
	ss := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-instance-gateway", Namespace: "test-agents"},
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
			Name:      "my-instance-gateway-0",
			Namespace: "test-agents",
			Labels:    map[string]string{"agent-platform.ai/role": "gateway", "controller-revision-hash": "rev-1"},
		},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionFalse}},
		},
	}
	r, client := setupReconciler(t, nil, ss, pod)

	require.NoError(t, r.forceRollStuckPod(context.Background(), "test-agents", "my-instance-gateway"))

	_, err := client.CoreV1().Pods("test-agents").Get(context.Background(), "my-instance-gateway-0", metav1.GetOptions{})
	assert.NoError(t, err, "no-op required when SS revisions match")
}

func TestReconcile_PatchesGatewayUpdateStrategyOnExistingStatefulSet(t *testing.T) {
	// applyStatefulSet must propagate UpdateStrategy to existing StatefulSets,
	// not just newly-created ones. Without this, updating the controller
	// to set maxUnavailable: 1 on the gateway only takes effect for
	// fresh installs — already-running pairs keep the default rolling
	// strategy and stay stuck behind CrashLoop pods on rev transitions.
	cm := instanceCM("running")
	// An existing gateway StatefulSet at the default (empty) update
	// strategy, simulating a pre-fix install.
	existingGateway := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-instance-gateway", Namespace: "test-agents"},
		Spec:       appsv1.StatefulSetSpec{Replicas: int32Ptr(1)},
	}
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm, existingGateway,
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)

	got, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-instance-gateway", metav1.GetOptions{})
	require.NoError(t, err)
	require.NotNil(t, got.Spec.UpdateStrategy.RollingUpdate, "rolling update strategy must be patched onto existing StatefulSets")
	require.NotNil(t, got.Spec.UpdateStrategy.RollingUpdate.MaxUnavailable)
	assert.Equal(t, "1", got.Spec.UpdateStrategy.RollingUpdate.MaxUnavailable.String())
}

func TestReconcile_AgentNotFound(t *testing.T) {
	cm := instanceCM("running")
	cm.Labels["agent-platform.ai/agent"] = "missing"
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{},
		cm,
	)

	err := r.Reconcile(context.Background(), cm)
	assert.Error(t, err)

	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "currentState: error")
}

func TestReconcile_Idempotent(t *testing.T) {
	cm := instanceCM("running")
	r, _ := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)
	// Second reconcile should not error
	err = r.Reconcile(context.Background(), cm)
	require.NoError(t, err)
}

func TestReconcile_SetsAgentOwnerReference(t *testing.T) {
	cm := instanceCM("running")
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
	)

	require.NoError(t, r.Reconcile(context.Background(), cm))

	updated, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, updated.OwnerReferences, 1)
	ref := updated.OwnerReferences[0]
	assert.Equal(t, "ConfigMap", ref.Kind)
	assert.Equal(t, "claude-code", ref.Name)
	assert.EqualValues(t, "agent-uid", ref.UID)
}

func TestReconcile_OwnerReferenceIdempotent(t *testing.T) {
	cm := instanceCM("running")
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
	)

	require.NoError(t, r.Reconcile(context.Background(), cm))
	require.NoError(t, r.Reconcile(context.Background(), cm))

	updated, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Len(t, updated.OwnerReferences, 1, "second reconcile must not duplicate owner reference")
}

func TestReconcile_PreservesExistingOwnerReferences(t *testing.T) {
	cm := instanceCM("running")
	cm.OwnerReferences = []metav1.OwnerReference{
		{APIVersion: "v1", Kind: "ConfigMap", Name: "other-owner", UID: "other-uid"},
	}
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
	)

	require.NoError(t, r.Reconcile(context.Background(), cm))

	updated, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, updated.OwnerReferences, 2)
	uids := []string{string(updated.OwnerReferences[0].UID), string(updated.OwnerReferences[1].UID)}
	assert.Contains(t, uids, "other-uid")
	assert.Contains(t, uids, "agent-uid")
}

func TestDelete_CleansPVCs(t *testing.T) {
	cm := instanceCM("running")
	// Pre-create PVCs that would have been created by the StatefulSet controller
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "home-agent-my-instance-0",
			Namespace: "test-agents",
			Labels:    map[string]string{"agent-platform.ai/instance": "my-instance"},
		},
	}
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm, pvc,
	)

	// Verify PVC exists before deletion
	ctx := context.Background()
	pvcs, err := client.CoreV1().PersistentVolumeClaims("test-agents").List(ctx, metav1.ListOptions{
		LabelSelector: "agent-platform.ai/instance=my-instance",
	})
	require.NoError(t, err)
	assert.Len(t, pvcs.Items, 1)

	// Delete instance — should clean up PVCs
	r.Delete(ctx, "my-instance")

	pvcs, err = client.CoreV1().PersistentVolumeClaims("test-agents").List(ctx, metav1.ListOptions{
		LabelSelector: "agent-platform.ai/instance=my-instance",
	})
	require.NoError(t, err)
	assert.Empty(t, pvcs.Items)
}

func TestReconcileOrphanPVCs(t *testing.T) {
	// orphan: PVC labeled for an instance whose ConfigMap is gone
	orphan := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "home-agent-deleted-instance-0",
			Namespace: "test-agents",
			Labels:    map[string]string{"agent-platform.ai/instance": "deleted-instance"},
		},
	}
	// live: PVC labeled for an instance that still has a ConfigMap
	live := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "home-agent-my-instance-0",
			Namespace: "test-agents",
			Labels:    map[string]string{"agent-platform.ai/instance": "my-instance"},
		},
	}
	liveCM := instanceCM("running") // name = "my-instance"
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		liveCM, orphan, live,
	)

	r.ReconcileOrphanPVCs(context.Background())

	// orphan removed
	_, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), orphan.Name, metav1.GetOptions{})
	assert.Error(t, err, "orphan PVC should be deleted")

	// live retained
	_, err = client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), live.Name, metav1.GetOptions{})
	assert.NoError(t, err, "live instance PVC must be retained")
}

func int32Ptr(i int32) *int32 { return &i }
