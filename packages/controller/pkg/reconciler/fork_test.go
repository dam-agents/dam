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
	"k8s.io/apimachinery/pkg/api/resource"
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
	// The fake clientset never stamps CreationTimestamp; the fork ready
	// timeout is measured from Job creation, so stamp the fixed test clock.
	client.PrependReactor("create", "jobs", func(action k8stesting.Action) (bool, runtime.Object, error) {
		job := action.(k8stesting.CreateAction).GetObject().(*batchv1.Job)
		if job.CreationTimestamp.IsZero() {
			job.CreationTimestamp = metav1.Time{Time: time.Unix(1_000_000, 0)}
		}
		return false, job, nil
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
		ForkHibernateAfter: 5 * time.Minute,
		ForkExpireAfter:    48 * time.Hour,
		// The fork budget gate runs on every Job create; give the test
		// replier generous room so lifecycle tests aren't budget tests.
		DefaultUserCPUBudget:    resource.MustParse("64"),
		DefaultUserMemoryBudget: resource.MustParse("256Gi"),
	}
	// The Fork CR is seeded into the dynamic fake — the reconciler writes its
	// status subresource there. Agents are resolved via the getter AND seeded
	// into the dynamic fake, mirroring the real cluster: the fork budget gate
	// reads parent Agent CRs off the dynamic API.
	var dynObjs []runtime.Object
	if fork != nil {
		u, err := forkToUnstructured(fork)
		require.NoError(t, err)
		dynObjs = append(dynObjs, u)
	}
	for _, a := range agents {
		raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(a)
		require.NoError(t, err)
		u := &unstructured.Unstructured{Object: raw}
		u.SetAPIVersion(apiv1.GroupVersion.String())
		u.SetKind("Agent")
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

// withLastActivity stamps the api-server-owned activity annotation the
// reconciler measures idleness from.
func withLastActivity(fork *apiv1.Fork, t time.Time) *apiv1.Fork {
	if fork.Annotations == nil {
		fork.Annotations = map[string]string{}
	}
	fork.Annotations[annLastActivity] = t.UTC().Format(time.RFC3339)
	return fork
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

func TestForkReconcile_ReadyForkSurvivesUnreadyBlip(t *testing.T) {
	// The ready-timeout applies only while establishing: an established
	// Ready fork whose pod blips unready (probe hiccup under load) must
	// ride it out — its Job is far older than the window by definition.
	fork := withLastActivity(
		forkCR("fork-blip", minimalForkSpec("my-agent"), time.Unix(1_000_000-10_000, 0)),
		time.Unix(1_000_000-1, 0))
	fork.Status.Phase = apiv1.ForkPhaseReady
	fork.Status.PodIP = "10.0.0.5"
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork,
		&batchv1.Job{ObjectMeta: metav1.ObjectMeta{
			Name: "fork-blip", Namespace: "test-agents",
			CreationTimestamp: metav1.Time{Time: time.Unix(1_000_000-10_000, 0)},
		}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{
			Name: "fork-blip-xyz", Namespace: "test-agents",
			Labels: map[string]string{ForkLabelForkID: "fork-blip"},
		}}, // present but not Ready
	)

	require.NoError(t, r.Reconcile(context.Background(), fork))

	status := readForkStatus(t, r, "fork-blip")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhaseReady, status.Phase, "a blip must not fail an established fork")
	_, err := client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-blip", metav1.GetOptions{})
	require.NoError(t, err, "the job must survive the blip")
}

func TestForkReconcile_WakeBumpVetoesHibernation(t *testing.T) {
	// The reconcile object is an informer-cache snapshot; a wake bump that
	// lands after the snapshot must veto the teardown it raced. The live
	// re-read (confirmIdle) is what catches it.
	fork := withLastActivity(
		forkCR("fork-raced", minimalForkSpec("my-agent"), time.Unix(1_000_000-3_600, 0)),
		time.Unix(1_000_000, 0).Add(-10*time.Minute))
	fork.Status.Phase = apiv1.ForkPhaseReady
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork,
		&batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "fork-raced", Namespace: "test-agents"}},
	)
	// Simulate the concurrent bump: freshen the annotation on the LIVE
	// object while the reconcile still holds the stale snapshot.
	u, err := r.dynamic.Resource(ForksGVR).Namespace("test-agents").Get(context.Background(), "fork-raced", metav1.GetOptions{})
	require.NoError(t, err)
	u.SetAnnotations(map[string]string{annLastActivity: time.Unix(1_000_000-1, 0).UTC().Format(time.RFC3339)})
	_, err = r.dynamic.Resource(ForksGVR).Namespace("test-agents").Update(context.Background(), u, metav1.UpdateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(context.Background(), fork))

	_, err = client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-raced", metav1.GetOptions{})
	require.NoError(t, err, "a fork woken mid-decision must keep its job")
}

func TestForkReconcile_GatewayRollsOnCredentialChange(t *testing.T) {
	// A durable fork's gateway outlives the replier's credential set: a
	// gateway pod whose secrets rev drifts from the desired render must be
	// recreated so Envoy reloads its bootstrap (a replier connecting a
	// credential AFTER the fork was created gets it injected mid-life).
	fork := forkCR("fork-roll", minimalForkSpec("my-agent"), time.Unix(1_000_000-1, 0))
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork,
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{
			Name: "fork-roll-gateway", Namespace: "test-agents",
			Annotations: map[string]string{"agent-platform.ai/envoy-secrets-rev": "stale-rev"},
		}},
	)

	require.NoError(t, r.Reconcile(context.Background(), fork))

	pod, err := client.CoreV1().Pods("test-agents").Get(context.Background(), "fork-roll-gateway", metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEqual(t, "stale-rev", pod.Annotations["agent-platform.ai/envoy-secrets-rev"],
		"gateway pod must be recreated with the current secrets rev")
	assert.NotEmpty(t, pod.Spec.Containers, "recreated pod must be the rendered gateway, not the stale stub")
}

func TestForkReconcile_OverBudgetReplierForkFails(t *testing.T) {
	// A fork reserves against the REPLIER at the parent's Size (#2843) —
	// when that doesn't fit their Ceiling the start is refused: Failed with
	// OverBudget, no Job. No parking; the next reply rebuilds and re-gates.
	fork := forkCR("fork-poor", minimalForkSpec("my-agent"), time.Unix(1_000_000-1, 0))
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)
	r.config.DefaultUserCPUBudget = resource.MustParse("500m")

	err := r.Reconcile(context.Background(), fork)
	require.Error(t, err)

	status := readForkStatus(t, r, "fork-poor")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhaseFailed, status.Phase)
	require.NotNil(t, status.Error)
	assert.Equal(t, types.ForkReasonOverBudget, status.Error.Reason)

	_, err = client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-poor", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "a refused fork must not get a job")
}

func TestForkReconcile_WakeRunsBudgetGate(t *testing.T) {
	// The gate keys on Job creation — every wake from hibernation re-checks,
	// so room freed while the fork slept is what admits it, not history.
	fork := withLastActivity(
		forkCR("fork-poor-wake", minimalForkSpec("my-agent"), time.Unix(1_000_000-3_600, 0)),
		time.Unix(1_000_000-1, 0))
	fork.Status.Phase = apiv1.ForkPhaseHibernated
	r, _ := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)
	r.config.DefaultUserCPUBudget = resource.MustParse("500m")

	err := r.Reconcile(context.Background(), fork)
	require.Error(t, err)

	status := readForkStatus(t, r, "fork-poor-wake")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhaseFailed, status.Phase)
	require.NotNil(t, status.Error)
	assert.Equal(t, types.ForkReasonOverBudget, status.Error.Reason)
}

func TestForkReservedByOwner_CountsLiveForksAtParentSize(t *testing.T) {
	fork := forkCR("fork-live", minimalForkSpec("my-agent"), time.Unix(1_000_000-1, 0))
	r, _ := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork,
		&batchv1.Job{ObjectMeta: metav1.ObjectMeta{
			Name: "fork-live", Namespace: "test-agents",
			Labels: map[string]string{ForkLabelType: ForkJobLabelType},
		}},
	)

	cpu, mem, err := forkReservedByOwner(context.Background(), r.client, r.dynamic, r.config, "kc-user-42")
	require.NoError(t, err)
	assert.Equal(t, "1", cpu.String(), "live fork reserves the parent's CPU size")
	assert.Equal(t, "2Gi", mem.String(), "live fork reserves the parent's memory size")

	// Nothing reserved for a different replier.
	cpu, mem, err = forkReservedByOwner(context.Background(), r.client, r.dynamic, r.config, "kc-other")
	require.NoError(t, err)
	assert.True(t, cpu.IsZero() && mem.IsZero())
}

func TestForkReservedByOwner_HibernatedForkReservesNothing(t *testing.T) {
	// No Job (hibernated) → no reservation: hibernation credits the budget
	// back like an agent's scale-down.
	fork := forkCR("fork-asleep", minimalForkSpec("my-agent"), time.Unix(1_000_000-3_600, 0))
	fork.Status.Phase = apiv1.ForkPhaseHibernated
	r, _ := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)

	cpu, mem, err := forkReservedByOwner(context.Background(), r.client, r.dynamic, r.config, "kc-user-42")
	require.NoError(t, err)
	assert.True(t, cpu.IsZero() && mem.IsZero())
}

func TestForkReconcile_RendersPerForkExtAuthzService(t *testing.T) {
	// The fork gateway dials its OWN ext-authz Service so egress Checks
	// carry the fork id (#2843). Rendered in the release namespace, cleaned
	// up by Delete (no cross-namespace ownerRef possible).
	fork := forkCR("fork-svc", minimalForkSpec("my-agent"), time.Unix(1_000_000-1, 0))
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)

	require.NoError(t, r.Reconcile(context.Background(), fork))

	svc, err := client.CoreV1().Services("default").Get(context.Background(),
		r.config.ExtAuthzServiceName("fork-svc"), metav1.GetOptions{})
	require.NoError(t, err, "per-fork ext-authz Service must exist in the release namespace")
	assert.Equal(t, "fork-svc", svc.Labels[LabelAgent])
}

func TestForkReconcile_OwnedByParentAgent(t *testing.T) {
	fork := forkCR("fork-own", minimalForkSpec("my-agent"), time.Unix(1_000_000-1, 0))
	r, _ := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)

	require.NoError(t, r.Reconcile(context.Background(), fork))

	u, err := r.dynamic.Resource(ForksGVR).Namespace("test-agents").Get(context.Background(), "fork-own", metav1.GetOptions{})
	require.NoError(t, err)
	refs := u.GetOwnerReferences()
	require.Len(t, refs, 1)
	assert.Equal(t, "Agent", refs[0].Kind)
	assert.Equal(t, "my-agent", refs[0].Name)
	assert.Equal(t, apitypes.UID("agent-uid"), refs[0].UID)
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
	// The ready timeout is measured from the Job's creation, not the CR's —
	// a durable CR outlives many wake cycles. Seed a Job older than the
	// window; the CR itself is recent.
	fork := forkCR("fork-3", minimalForkSpec("my-agent"), time.Unix(1_000_000-200, 0))
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork,
		&batchv1.Job{ObjectMeta: metav1.ObjectMeta{
			Name: "fork-3", Namespace: "test-agents",
			CreationTimestamp: metav1.Time{Time: time.Unix(1_000_000-200, 0)},
		}},
	)

	err := r.Reconcile(context.Background(), fork)
	require.Error(t, err)

	status := readForkStatus(t, r, "fork-3")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhaseFailed, status.Phase)
	require.NotNil(t, status.Error)
	assert.Equal(t, types.ForkReasonTimeout, status.Error.Reason)

	// Failure tears the runnable surface down; the stuck Job must not linger.
	_, err = client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-3", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "failed fork's job must be deleted")
}

func TestForkReconcile_FreshJobWithinTimeoutStaysPending(t *testing.T) {
	// A CR far older than the ready window must not time out a *fresh* wake:
	// the Job the reconcile just created is what the clock runs against.
	fork := withLastActivity(
		forkCR("fork-wake-fresh", minimalForkSpec("my-agent"), time.Unix(1_000_000-10_000, 0)),
		time.Unix(1_000_000-1, 0))
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)

	require.NoError(t, r.Reconcile(context.Background(), fork))

	_, err := client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-wake-fresh", metav1.GetOptions{})
	require.NoError(t, err)
	status := readForkStatus(t, r, "fork-wake-fresh")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhasePending, status.Phase)
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

func TestForkReconcile_ExpiredIdleForkIsDeleted(t *testing.T) {
	// Tier two of the idle policy: days idle → the CR itself goes, and K8s
	// GC sweeps everything owner-refed to it.
	fork := withLastActivity(
		forkCR("fork-expired", minimalForkSpec("my-agent"), time.Unix(1_000_000-200_000, 0)),
		time.Unix(1_000_000, 0).Add(-49*time.Hour))
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)

	require.NoError(t, r.Reconcile(context.Background(), fork))

	_, err := r.dynamic.Resource(ForksGVR).Namespace("test-agents").Get(context.Background(), "fork-expired", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "expired fork CR must be deleted")
	_, err = client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-expired", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "no job should be created for an expired fork")
}

func TestForkReconcile_ExpiredFailedForkIsDeleted(t *testing.T) {
	// Expiry runs ahead of the terminal-phase short-circuit: a Failed CR the
	// api-server never cleaned up ages out too.
	fork := withLastActivity(
		forkCR("fork-expired-failed", minimalForkSpec("my-agent"), time.Unix(1_000_000-200_000, 0)),
		time.Unix(1_000_000, 0).Add(-49*time.Hour))
	fork.Status.Phase = apiv1.ForkPhaseFailed
	r, _ := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)

	require.NoError(t, r.Reconcile(context.Background(), fork))

	_, err := r.dynamic.Resource(ForksGVR).Namespace("test-agents").Get(context.Background(), "fork-expired-failed", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "expired Failed fork CR must be deleted")
}

func TestForkReconcile_ExpiredBusyForkIsSpared(t *testing.T) {
	// A turn still running is activity, however stale the annotation — the
	// busy probe guards expiry exactly as it guards hibernation.
	fork := withLastActivity(
		forkCR("fork-expired-busy", minimalForkSpec("my-agent"), time.Unix(1_000_000-200_000, 0)),
		time.Unix(1_000_000, 0).Add(-49*time.Hour))
	fork.Status.Phase = apiv1.ForkPhaseReady
	r, _ := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)
	r.busyProbe = func(context.Context, string) bool { return true }

	require.NoError(t, r.Reconcile(context.Background(), fork))

	_, err := r.dynamic.Resource(ForksGVR).Namespace("test-agents").Get(context.Background(), "fork-expired-busy", metav1.GetOptions{})
	require.NoError(t, err, "busy fork must not be expired")
}

func TestForkReconcile_IdleForkHibernates(t *testing.T) {
	// Tier one: minutes idle → pods torn down, CR and identity resources
	// retained, phase Hibernated.
	fork := withLastActivity(
		forkCR("fork-h", minimalForkSpec("my-agent"), time.Unix(1_000_000-3_600, 0)),
		time.Unix(1_000_000, 0).Add(-10*time.Minute))
	fork.Status.Phase = apiv1.ForkPhaseReady
	fork.Status.PodIP = "10.0.0.5"
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork,
		&batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "fork-h", Namespace: "test-agents"}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "fork-h-gateway", Namespace: "test-agents"}},
	)

	require.NoError(t, r.Reconcile(context.Background(), fork))

	_, err := client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-h", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "hibernated fork's job must be deleted")
	_, err = client.CoreV1().Pods("test-agents").Get(context.Background(), "fork-h-gateway", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "hibernated fork's gateway pod must be deleted")

	status := readForkStatus(t, r, "fork-h")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhaseHibernated, status.Phase)
	assert.Empty(t, status.PodIP, "hibernated status must not advertise a pod IP")
}

func TestForkReconcile_BusyForkSkipsHibernation(t *testing.T) {
	fork := withLastActivity(
		forkCR("fork-busy", minimalForkSpec("my-agent"), time.Unix(1_000_000-3_600, 0)),
		time.Unix(1_000_000, 0).Add(-10*time.Minute))
	fork.Status.Phase = apiv1.ForkPhaseReady
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork,
		&batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "fork-busy", Namespace: "test-agents"}},
	)
	r.busyProbe = func(context.Context, string) bool { return true }

	require.NoError(t, r.Reconcile(context.Background(), fork))

	_, err := client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-busy", metav1.GetOptions{})
	require.NoError(t, err, "busy fork's job must survive the hibernate window")
	status := readForkStatus(t, r, "fork-busy")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhaseReady, status.Phase)
}

func TestForkReconcile_HibernatedForkStaysDown(t *testing.T) {
	// A hibernated fork with no fresh activity is a no-op each resync — no
	// pod churn, no status writes.
	fork := withLastActivity(
		forkCR("fork-sleeping", minimalForkSpec("my-agent"), time.Unix(1_000_000-3_600, 0)),
		time.Unix(1_000_000, 0).Add(-10*time.Minute))
	fork.Status.Phase = apiv1.ForkPhaseHibernated
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)

	require.NoError(t, r.Reconcile(context.Background(), fork))

	_, err := client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-sleeping", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err), "no job for a fork that stays hibernated")
	status := readForkStatus(t, r, "fork-sleeping")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhaseHibernated, status.Phase)
}

func TestForkReconcile_HibernatedForkWakesOnActivity(t *testing.T) {
	// A fresh activity bump re-enters the ordinary provisioning path: Job
	// recreated, phase back through Pending toward Ready.
	fork := withLastActivity(
		forkCR("fork-waking", minimalForkSpec("my-agent"), time.Unix(1_000_000-3_600, 0)),
		time.Unix(1_000_000-1, 0))
	fork.Status.Phase = apiv1.ForkPhaseHibernated
	r, client := setupForkReconciler(t, map[string]*apiv1.Agent{"my-agent": agentCR()}, fork)

	require.NoError(t, r.Reconcile(context.Background(), fork))

	_, err := client.BatchV1().Jobs("test-agents").Get(context.Background(), "fork-waking", metav1.GetOptions{})
	require.NoError(t, err, "waking fork must get its job back")
	status := readForkStatus(t, r, "fork-waking")
	require.NotNil(t, status)
	assert.Equal(t, apiv1.ForkPhasePending, status.Phase)
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

// --- Warm-pool parent PVC resolution (#692) ---

func TestFork_ResolvesParentWorkspacePVCByLabel(t *testing.T) {
	// A warm-pool-claimed parent workspace PVC has a generated name, not the
	// `<mount>-<agent>-0` convention — the fork must find it by label.
	parentPVC := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "platform-pool-zzzzzz",
			Namespace: "test-agents",
			Labels:    map[string]string{LabelAgent: "parent-agent", LabelMount: "home-agent", LabelPool: "10Gi"},
		},
	}
	r, _ := setupForkReconciler(t, nil, nil, parentPVC)
	spec := &types.AgentSpec{Mounts: []types.Mount{{Path: "/home/agent", Persist: true}, {Path: "/tmp", Persist: false}}}

	got, err := resolveParentWorkspacePVCs(context.Background(), r.client, r.config, "parent-agent", spec)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"home-agent": "platform-pool-zzzzzz"}, got)
}

func TestFork_FallsBackToConventionPVCName(t *testing.T) {
	// Agents created before the mount label exists have no labeled PVC; the
	// fork falls back to the legacy convention name, which is still their real
	// PVC name.
	r, _ := setupForkReconciler(t, nil, nil)
	spec := &types.AgentSpec{Mounts: []types.Mount{{Path: "/home/agent", Persist: true}}}

	got, err := resolveParentWorkspacePVCs(context.Background(), r.client, r.config, "legacy-agent", spec)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"home-agent": "home-agent-legacy-agent-0"}, got)
}

func TestRewriteParentPVCs_RewritesClaimName(t *testing.T) {
	volumes := []corev1.Volume{
		{Name: "home-agent", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "home-agent-p-0"}}},
		{Name: "ca-cert", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}},
	}

	rewriteParentPVCs(volumes, map[string]string{"home-agent": "platform-pool-zzzzzz"})

	assert.Equal(t, "platform-pool-zzzzzz", volumes[0].PersistentVolumeClaim.ClaimName)
	assert.Nil(t, volumes[1].PersistentVolumeClaim, "non-PVC volume untouched")
}
