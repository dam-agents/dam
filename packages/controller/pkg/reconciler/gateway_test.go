package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestBuildGatewayStatefulSet_Shape(t *testing.T) {
	secrets := []corev1.Secret{credSecret("platform-cred-aaa", "api.example.com")}
	ss := BuildGatewayStatefulSet("my-instance", testOwner, false, "", testConfig, configMapOwnerRef(testOwnerCM), secrets, nil, false)

	require.NotNil(t, ss)
	assert.Equal(t, "my-instance-gateway", ss.Name)
	assert.Equal(t, "test-agents", ss.Namespace)
	assert.Equal(t, int32(1), *ss.Spec.Replicas)

	require.Len(t, ss.OwnerReferences, 1)
	assert.Equal(t, "cm-uid-123", string(ss.OwnerReferences[0].UID))

	labels := ss.Spec.Template.Labels
	assert.Equal(t, "my-instance", labels["agent-platform.ai/agent"])
	assert.Equal(t, "my-instance", labels["agent-platform.ai/pair"])
	assert.Equal(t, "gateway", labels["agent-platform.ai/role"])
	assert.Equal(t, testOwner, labels[envoyOwnerLabel], "a runner's egress admits gateways by this label")
	assert.NotContains(t, ss.Spec.Selector.MatchLabels, envoyOwnerLabel,
		"a StatefulSet selector is immutable, so the owner label is on the pods only and existing gateways keep reconciling")

	require.Len(t, ss.Spec.Template.Spec.Containers, 1, "gateway pod has exactly one Envoy container")
	envoy := ss.Spec.Template.Spec.Containers[0]
	assert.Equal(t, "envoy", envoy.Name)
	assert.Equal(t, "mirror.gcr.io/envoyproxy/envoy:distroless-v1.39.4", envoy.Image)

	mountPaths := map[string]string{}
	for _, m := range envoy.VolumeMounts {
		mountPaths[m.Name] = m.MountPath
	}
	assert.Equal(t, "/etc/envoy/credentials/cred-platform-cred-aaa", mountPaths["cred-platform-cred-aaa"])
	assert.Equal(t, "/etc/envoy/tls", mountPaths["envoy-tls"])
	assert.Equal(t, "/etc/envoy", mountPaths["envoy-bootstrap"])
}

func TestBuildGatewayStatefulSet_Hibernated(t *testing.T) {
	ss := BuildGatewayStatefulSet("my-instance", testOwner, true, "", testConfig, configMapOwnerRef(testOwnerCM), nil, nil, false)
	assert.Equal(t, int32(0), *ss.Spec.Replicas, "gateway scales with the agent")
}

func TestBuildGatewayStatefulSet_AutomountSAFalse(t *testing.T) {
	ss := BuildGatewayStatefulSet("my-instance", testOwner, false, "", testConfig, configMapOwnerRef(testOwnerCM), nil, nil, false)
	require.NotNil(t, ss.Spec.Template.Spec.AutomountServiceAccountToken)
	assert.False(t, *ss.Spec.Template.Spec.AutomountServiceAccountToken,
		"gateway pod must have no SA token — Secret-read RBAC would bypass volume-mount scoping")
	require.NotNil(t, ss.Spec.Template.Spec.EnableServiceLinks)
	assert.False(t, *ss.Spec.Template.Spec.EnableServiceLinks,
		"service links would inject one env var set per sibling agent Service; nothing in the pod reads them")
}

func TestBuildGatewayStatefulSet_RollingUpdateMaxUnavailable(t *testing.T) {
	ss := BuildGatewayStatefulSet("my-instance", testOwner, false, "", testConfig, configMapOwnerRef(testOwnerCM), nil, nil, false)
	require.NotNil(t, ss.Spec.UpdateStrategy.RollingUpdate, "rolling update strategy must be set explicitly")
	require.NotNil(t, ss.Spec.UpdateStrategy.RollingUpdate.MaxUnavailable)
	assert.Equal(t, "1", ss.Spec.UpdateStrategy.RollingUpdate.MaxUnavailable.String(),
		"single-replica gateway must allow 1 unavailable so rollouts can proceed past a CrashLoop pod")
}

func TestBuildGatewayStatefulSet_NoAgentVolumes(t *testing.T) {
	ss := BuildGatewayStatefulSet("my-instance", testOwner, false, "", testConfig, configMapOwnerRef(testOwnerCM), nil, nil, false)
	for _, v := range ss.Spec.Template.Spec.Volumes {
		assert.NotContains(t, v.Name, "home-agent",
			"gateway must not mount the workspace PVC")
		assert.NotEqual(t, "ca-cert", v.Name,
			"ca-cert is the agent-side projection; gateway holds the full leaf Secret")
	}
}

func TestBuildGatewayService(t *testing.T) {
	svc := BuildGatewayService("my-instance", false, testConfig, configMapOwnerRef(testOwnerCM))
	assert.Equal(t, "my-instance-gateway", svc.Name)
	assert.Empty(t, svc.Spec.ClusterIP, "gateway Service must not be headless")
	require.Len(t, svc.Spec.Ports, 1)
	assert.Equal(t, "proxy", svc.Spec.Ports[0].Name)
	assert.Equal(t, int32(10000), svc.Spec.Ports[0].Port)

	assert.Equal(t, "my-instance", svc.Spec.Selector["agent-platform.ai/pair"])
	assert.Equal(t, "gateway", svc.Spec.Selector["agent-platform.ai/role"])
}

func TestLabelContract(t *testing.T) {
	assert.Equal(t, "agent-platform.ai/agent", LabelAgent)
	assert.Equal(t, "agent-platform.ai/pair", LabelPair)
	assert.Equal(t, "agent-platform.ai/role", LabelRole)
	assert.Equal(t, "agent", RoleAgent)
	assert.Equal(t, "gateway", RoleGateway)
}

// TEST_SCENARIO: a rotated credential reaches the gateway only when the kubelet re-syncs its pod, so a new resource version on a mounted credential Secret must change the gateway pod's annotation, and nothing else may. An unchanged set writes nothing, so the pod update this causes does not loop the reconcile, and an allow-only Secret, which is never mounted, does not count.
func TestRefreshGatewayCredentials_AnnotatesOnRotationOnly(t *testing.T) {
	ctx := context.Background()
	client := fake.NewSimpleClientset(&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "a-gateway-0", Namespace: testConfig.Namespace}})
	r := NewAgentReconciler(client, nil, testConfig)
	cred := credSecret("platform-cred-aaa", "api.example.com")
	cred.ResourceVersion = "1"
	allowOnly := credSecret("platform-cred-bbb", "allow.example.com")
	allowOnly.Labels[envoySecretTypeLabel] = envoySecretTypeAllowOnly
	allowOnly.ResourceVersion = "1"
	now := time.Date(2026, 10, 19, 18, 4, 12, 0, time.UTC)
	refresh := func(at time.Time, secrets ...corev1.Secret) time.Duration {
		recheck, err := r.refreshGatewayCredentials(ctx, "a-gateway", secrets, at)
		require.NoError(t, err)
		return recheck
	}

	refresh(now, cred, allowOnly)
	first := gatewayPodAnnotations(t, client, "a-gateway-0")[annGatewayCredentialsRev]
	require.NotEmpty(t, first)
	refresh(now.Add(time.Minute), cred, allowOnly)
	settled := patchCount(client)

	allowOnly.ResourceVersion = "2"
	assert.Zero(t, refresh(now.Add(2*time.Minute), cred, allowOnly))
	assert.Equal(t, settled, patchCount(client), "an unchanged mounted set must not write the pod")

	cred.ResourceVersion = "2"
	refresh(now.Add(3*time.Minute), cred, allowOnly)
	assert.NotEqual(t, first, gatewayPodAnnotations(t, client, "a-gateway-0")[annGatewayCredentialsRev], "a rotated credential must change the annotation")

	_, err := r.refreshGatewayCredentials(ctx, "b-gateway", []corev1.Secret{cred}, now)
	require.NoError(t, err, "a hibernated gateway has no pod to refresh")
}

// TEST_SCENARIO: the sync one annotation change causes can run before the kubelet's own copy of the Secret has the new version, and the old key then stays mounted until the periodic sync, a minute later. So a rotation must sync the pod a second time once the kubelet's copy has caught up: the first change asks to come back after the wait, an early return writes nothing and asks again for the time left, and the return after the wait changes a second annotation. Both done, the revision is settled and writes nothing more. A pod with no revision yet mounted its Secrets when it started, so it takes both at once and nothing comes back for it.
func TestRefreshGatewayCredentials_SyncsTwiceForAStaleKubeletCopy(t *testing.T) {
	ctx := context.Background()
	client := fake.NewSimpleClientset(&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "a-gateway-0", Namespace: testConfig.Namespace}})
	r := NewAgentReconciler(client, nil, testConfig)
	cred := credSecret("platform-cred-aaa", "api.example.com")
	cred.ResourceVersion = "7"
	now := time.Date(2026, 10, 19, 18, 4, 12, 0, time.UTC)
	refresh := func(at time.Time) time.Duration {
		recheck, err := r.refreshGatewayCredentials(ctx, "a-gateway", []corev1.Secret{cred}, at)
		require.NoError(t, err)
		return recheck
	}

	assert.Zero(t, refresh(now), "a pod with no revision yet mounted its Secrets when it started")
	assert.Equal(t, 1, patchCount(client))
	ann := gatewayPodAnnotations(t, client, "a-gateway-0")
	assert.Equal(t, ann[annGatewayCredentialsRev], ann[annGatewayCredentialsResync])

	cred.ResourceVersion = "8"
	assert.Equal(t, gatewayCredentialsResyncWait, refresh(now), "the first sync after a rotation asks to come back for the second")
	assert.Equal(t, 2, patchCount(client))
	ann = gatewayPodAnnotations(t, client, "a-gateway-0")
	assert.NotEqual(t, ann[annGatewayCredentialsRev], ann[annGatewayCredentialsResync], "the second sync is still due")

	assert.Equal(t, gatewayCredentialsResyncWait-2*time.Second, refresh(now.Add(2*time.Second)), "an early return waits for the time left")
	assert.Equal(t, 2, patchCount(client), "an early return writes nothing")

	assert.Zero(t, refresh(now.Add(gatewayCredentialsResyncWait)))
	assert.Equal(t, 3, patchCount(client), "the second sync is a second write")
	ann = gatewayPodAnnotations(t, client, "a-gateway-0")
	assert.Equal(t, ann[annGatewayCredentialsRev], ann[annGatewayCredentialsResync])

	assert.Zero(t, refresh(now.Add(time.Minute)))
	assert.Equal(t, 3, patchCount(client), "a settled revision writes nothing")
}

func gatewayPodAnnotations(t *testing.T, client *fake.Clientset, pod string) map[string]string {
	t.Helper()
	p, err := client.CoreV1().Pods(testConfig.Namespace).Get(context.Background(), pod, metav1.GetOptions{})
	require.NoError(t, err)
	return p.Annotations
}

func patchCount(client *fake.Clientset) int {
	n := 0
	for _, a := range client.Actions() {
		if a.GetVerb() == "patch" {
			n++
		}
	}
	return n
}
