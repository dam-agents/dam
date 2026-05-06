package reconciler

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

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
		WaypointName:      "platform-apiserver-waypoint",
		IstioTrustDomain:  "cluster.local",
	}
	getter := &fakeGetter{cms: agents}
	// Dynamic fake client backs `applyAuthorizationPolicy` (Istio
	// security.istio.io/v1) and `applyCertificate` (cert-manager.io/v1).
	// Both are unstructured paths in the reconciler.
	scheme := runtime.NewScheme()
	dyn := dynamicfake.NewSimpleDynamicClient(scheme)
	r := NewInstanceReconciler(client, cfg, NewAgentResolver(getter)).WithDynamicClient(dyn)
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

	// Both NetworkPolicies created
	_, err = client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, "my-instance-egress", metav1.GetOptions{})
	require.NoError(t, err)
	_, err = client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, "my-instance-gateway-egress", metav1.GetOptions{})
	require.NoError(t, err, "gateway NetworkPolicy must be created")

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

func TestReconcile_ReconcilesServiceAccountDrift(t *testing.T) {
	// Pre-existing SA with the right name but wrong shape — simulating an
	// upgrade from a prior controller version, manual creation, or a SA
	// left over from a different release. The reconciler must converge it,
	// not silently accept the drift; otherwise the per-instance SA loses
	// its owner reference (no GC on instance delete) or its labels (broken
	// selectors).
	cm := instanceCM("running")
	staleSA := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-instance",
			Namespace: "test-agents",
			Labels:    map[string]string{"unrelated": "true"},
			// no OwnerReferences — would orphan the SA on instance delete
		},
		// AutomountServiceAccountToken left as default (pointer-to-true) —
		// not what BuildInstanceServiceAccount produces (false).
	}
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm, staleSA,
	)

	require.NoError(t, r.Reconcile(context.Background(), cm))

	got, err := client.CoreV1().ServiceAccounts("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-instance", got.Labels["agent-platform.ai/instance"],
		"reconciler must overwrite drifted labels so selectors keep finding the SA")
	require.Len(t, got.OwnerReferences, 1,
		"reconciler must set the instance-CM owner reference so K8s GC reaps the SA")
	assert.EqualValues(t, "uid-1", got.OwnerReferences[0].UID)
	require.NotNil(t, got.AutomountServiceAccountToken)
	assert.False(t, *got.AutomountServiceAccountToken)
}

func int32Ptr(i int32) *int32 { return &i }
