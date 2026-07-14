package reconciler

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

// Budget-check matrix (#1900). These run through the full Reconcile so the
// condition lifecycle (OverBudget stamped on deny, Hibernated restamped by
// the idle sweep) and the scale decision are exercised together — the
// transitions aren't reliably observable by manual smoke.

const budgetOwner = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

// ownedAgentCR is agentCR() with an owner label and an explicit size
// (limits — the budgeted quantity).
func ownedAgentCR(name, cpu, memory string) *apiv1.Agent {
	a := agentCR()
	a.Name = name
	a.Labels = map[string]string{"agent-platform.ai/owner": budgetOwner}
	a.Spec.Resources.Limits = map[string]string{"cpu": cpu, "memory": memory}
	return a
}

// runningPeer returns the CR + scaled-up agent StatefulSet for a peer agent
// of the same owner, as the budget check discovers them.
func runningPeer(name, cpu, memory string) (*apiv1.Agent, *appsv1.StatefulSet) {
	one := int32(1)
	return ownedAgentCR(name, cpu, memory), &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents",
			Labels: map[string]string{LabelAgent: name},
		},
		Spec: appsv1.StatefulSetSpec{Replicas: &one},
	}
}

func userBudgetCR(cpu, memory string) *unstructured.Unstructured {
	b := &apiv1.UserBudget{
		ObjectMeta: metav1.ObjectMeta{Name: "budget-" + budgetOwner, Namespace: "test-agents"},
		Spec: apiv1.UserBudgetSpec{
			Owner:  budgetOwner,
			CPU:    resource.MustParse(cpu),
			Memory: resource.MustParse(memory),
		},
	}
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(b)
	if err != nil {
		panic(err)
	}
	u := &unstructured.Unstructured{Object: raw}
	u.SetAPIVersion(apiv1.GroupVersion.String())
	u.SetKind("UserBudget")
	return u
}

func agentSSReplicas(t *testing.T, r *AgentReconciler, name string) int32 {
	t.Helper()
	ss, err := r.client.AppsV1().StatefulSets("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	require.NotNil(t, ss.Spec.Replicas)
	return *ss.Spec.Replicas
}

func readyCondition(t *testing.T, r *AgentReconciler, name string) *metav1.Condition {
	t.Helper()
	obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	a, err := FromCacheObject[apiv1.Agent](obj)
	require.NoError(t, err)
	for i := range a.Status.Conditions {
		if a.Status.Conditions[i].Type == apiv1.ConditionReady {
			return &a.Status.Conditions[i]
		}
	}
	return nil
}

func TestBudgetUnderCeilingScalesUp(t *testing.T) {
	agent := ownedAgentCR("my-agent", "250m", "512Mi")
	r, _ := setupReconciler(t, agent)
	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"))
}

func TestBudgetOverCeilingParksWithFigures(t *testing.T) {
	// Peer reserves 3.9 CPU of the 4-CPU default ceiling; the 250m candidate
	// overflows and must park at zero with the figures on Ready.
	peer, peerSS := runningPeer("peer", "3900m", "1Gi")
	agent := ownedAgentCR("my-agent", "250m", "512Mi")
	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)

	r, _ := setupReconciler(t, agent, peerSS)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(context.Background(), peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"))
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, metav1.ConditionFalse, cond.Status)
	assert.Equal(t, apiv1.ReasonOverBudget, cond.Reason)
	assert.Contains(t, cond.Message, "CPU")
	assert.Contains(t, cond.Message, "stop a running sandbox")
}

func TestBudgetDeniesOnMemoryDimensionAlone(t *testing.T) {
	// CPU fits comfortably; memory alone overflows the 8Gi default ceiling.
	peer, peerSS := runningPeer("peer", "250m", "7900Mi")
	agent := ownedAgentCR("my-agent", "250m", "512Mi")
	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)

	r, _ := setupReconciler(t, agent, peerSS)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(context.Background(), peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"))
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonOverBudget, cond.Reason)
}

func TestBudgetIgnoresScaledDownPeers(t *testing.T) {
	// A hibernated peer (desired replicas 0) reserves nothing, even with a
	// huge footprint on its spec.
	peer, peerSS := runningPeer("peer", "3900m", "7Gi")
	zero := int32(0)
	peerSS.Spec.Replicas = &zero
	agent := ownedAgentCR("my-agent", "250m", "512Mi")
	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)

	r, _ := setupReconciler(t, agent, peerSS)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(context.Background(), peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"))
}

func TestBudgetParkedDoesNotAutoStartWhenRoomFrees(t *testing.T) {
	// A denied wake is remembered: freeing room must NOT start the parked
	// agent by itself; a fresh last-activity bump (a new deliberate wake)
	// retries the gate.
	peer, peerSS := runningPeer("peer", "3900m", "1Gi")
	agent := ownedAgentCR("my-agent", "250m", "512Mi")
	agent.Annotations = map[string]string{
		"agent-platform.ai/last-activity": time.Now().UTC().Format(time.RFC3339),
	}
	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)

	r, client := setupReconciler(t, agent, peerSS)
	ctx := context.Background()
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	require.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"))

	// Room frees (peer scales to zero) — resync re-reconciles the parked
	// agent, which must stay down.
	zero := int32(0)
	peerSS.Spec.Replicas = &zero
	_, err = client.AppsV1().StatefulSets("test-agents").Update(ctx, peerSS, metav1.UpdateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"))

	// A new deliberate wake (fresh bump) retries the gate and now fits.
	agent.Annotations["agent-platform.ai/last-activity"] =
		time.Now().UTC().Add(time.Second).Format(time.RFC3339)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"))
}

func TestBudgetAlwaysOnAgentAutoStartsWhenRoomFrees(t *testing.T) {
	// A never-hibernate agent declares "always run": it is exempt from the
	// denial memo and starts by itself once room frees.
	peer, peerSS := runningPeer("peer", "3900m", "1Gi")
	agent := ownedAgentCR("my-agent", "250m", "512Mi")
	never := metav1.Duration{Duration: 0}
	agent.Spec.HibernationTimeout = &never
	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)

	r, client := setupReconciler(t, agent, peerSS)
	ctx := context.Background()
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	require.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"))

	zero := int32(0)
	peerSS.Spec.Replicas = &zero
	_, err = client.AppsV1().StatefulSets("test-agents").Update(ctx, peerSS, metav1.UpdateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"))
}

func TestBudgetUserBudgetOverrideAdmits(t *testing.T) {
	// Same overflow as above, but a UserBudget raises this owner's ceiling.
	peer, peerSS := runningPeer("peer", "3900m", "1Gi")
	agent := ownedAgentCR("my-agent", "250m", "512Mi")
	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)

	r, _ := setupReconciler(t, agent, peerSS)
	ctx := context.Background()
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, peerU, metav1.CreateOptions{})
	require.NoError(t, err)
	_, err = r.dynamic.Resource(UserBudgetsGVR).Namespace("test-agents").Create(ctx, userBudgetCR("8", "16Gi"), metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"))
}

func TestBudgetLegacyPeerCountsAtLegacySize(t *testing.T) {
	// A peer whose spec predates create-time stamping has no limits; it
	// counts at the chart's legacyAgentSize — the value the fill will
	// materialize on the peer's own next reconcile — never zero.
	peer, peerSS := runningPeer("peer", "", "")
	peer.Spec.Resources = apiv1.ResourceSpec{}
	agent := ownedAgentCR("my-agent", "250m", "512Mi")
	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)

	r, _ := setupReconciler(t, agent, peerSS)
	// Legacy size sized so the unfilled peer alone fills the CPU ceiling.
	r.config.LegacyAgentCPULimit = resource.MustParse("3900m")
	r.config.LegacyAgentMemoryLimit = resource.MustParse("1Gi")
	ctx := context.Background()
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"))
}

func TestReconcileMaterializesLegacySizeIntoSpec(t *testing.T) {
	// "Required without the schema saying so" (#1900): a limitless Agent —
	// legacy, kubectl-applied, GitOps — gets the legacyAgentSize persisted
	// into its spec on its first reconcile, and the SAME pass renders with
	// those values, so it never runs at the wrong default even transiently.
	agent := ownedAgentCR("my-agent", "", "")
	agent.Spec.Resources = apiv1.ResourceSpec{}
	r, _ := setupReconciler(t, agent)
	ctx := context.Background()

	require.NoError(t, r.Reconcile(ctx, agent))

	obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	stamped, err := FromCacheObject[apiv1.Agent](obj)
	require.NoError(t, err)
	assert.Equal(t, "1", stamped.Spec.Resources.Limits["cpu"])
	assert.Equal(t, "2Gi", stamped.Spec.Resources.Limits["memory"])

	ss, err := r.client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	var agentContainer *corev1.Container
	for i := range ss.Spec.Template.Spec.Containers {
		if ss.Spec.Template.Spec.Containers[i].Name == AgentContainerName {
			agentContainer = &ss.Spec.Template.Spec.Containers[i]
		}
	}
	require.NotNil(t, agentContainer)
	cpuLimit := agentContainer.Resources.Limits[corev1.ResourceCPU]
	memLimit := agentContainer.Resources.Limits[corev1.ResourceMemory]
	assert.Equal(t, "1", cpuLimit.String())
	assert.Equal(t, "2Gi", memLimit.String())
}

func TestReconcileFillsOnlyAbsentSizeDimensions(t *testing.T) {
	// Fill-if-absent, never overwrite: a spec with memory set but cpu
	// missing gets only cpu materialized — the set dimension is user (or
	// operator) intent and the controller must not touch it.
	agent := ownedAgentCR("my-agent", "", "")
	agent.Spec.Resources = apiv1.ResourceSpec{Limits: map[string]string{"memory": "4Gi"}}
	r, _ := setupReconciler(t, agent)
	ctx := context.Background()

	require.NoError(t, r.Reconcile(ctx, agent))

	obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	stamped, err := FromCacheObject[apiv1.Agent](obj)
	require.NoError(t, err)
	assert.Equal(t, "1", stamped.Spec.Resources.Limits["cpu"])
	assert.Equal(t, "4Gi", stamped.Spec.Resources.Limits["memory"])
}

func TestBudgetRunningAgentNeverRechecked(t *testing.T) {
	// The agent is already scaled up; a ceiling far below its own footprint
	// must not evict or park it — the budget constrains starting only.
	agent := ownedAgentCR("my-agent", "2", "4Gi")
	one := int32(1)
	ownSS := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-agent", Namespace: "test-agents",
			Labels: map[string]string{LabelAgent: "my-agent"},
		},
		Spec: appsv1.StatefulSetSpec{Replicas: &one},
	}
	r, _ := setupReconciler(t, agent, ownSS)
	r.config.DefaultUserCPUBudget = resource.MustParse("100m")
	r.config.DefaultUserMemoryBudget = resource.MustParse("64Mi")

	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"))
	cond := readyCondition(t, r, "my-agent")
	if cond != nil {
		assert.NotEqual(t, apiv1.ReasonOverBudget, cond.Reason)
	}
}

func TestBudgetParkedRevertsToHibernatedAfterWindow(t *testing.T) {
	// A parked agent whose activity window lapsed is swept by the idle
	// checker, which restamps Hibernated over OverBudget.
	peer, peerSS := runningPeer("peer", "3900m", "1Gi")
	agent := ownedAgentCR("my-agent", "250m", "512Mi")
	stale := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent.Annotations = map[string]string{"agent-platform.ai/last-activity": stale}
	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)

	r, _ := setupReconciler(t, agent, peerSS)
	ctx := context.Background()
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	// Park it first: fresh activity → wants to run → denied.
	agent.Annotations["agent-platform.ai/last-activity"] = time.Now().UTC().Format(time.RFC3339)
	require.NoError(t, r.Reconcile(ctx, agent))
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	require.Equal(t, apiv1.ReasonOverBudget, cond.Reason)

	// Window lapses; the idle sweep hibernates (pods already at zero — the
	// probe is overridden to not-busy, as for any unreachable pod).
	stampStale := map[string]interface{}{"agent-platform.ai/last-activity": stale}
	obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	require.NoError(t, unstructured.SetNestedMap(obj.Object, stampStale, "metadata", "annotations"))
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, obj, metav1.UpdateOptions{})
	require.NoError(t, err)

	checker := NewIdleChecker(r.client, r.dynamic, r.config)
	checker.busyProbe = func(context.Context, string) bool { return false }
	checker.check(ctx)

	cond = readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonHibernated, cond.Reason)
	assert.False(t, strings.Contains(cond.Message, "CPU"))
}

func TestBudgetDenialHealsStrandedGateway(t *testing.T) {
	// An admitted reconcile scales the gateway up before the agent
	// StatefulSet applies; if it then fails transiently and the retry is
	// denied, the denial must scale the stranded gateway back to zero
	// rather than leaving an orphan pod running until the idle sweep.
	peer, peerSS := runningPeer("peer", "3900m", "1Gi")
	agent := ownedAgentCR("my-agent", "250m", "512Mi")
	agent.Annotations = map[string]string{
		"agent-platform.ai/last-activity": time.Now().UTC().Format(time.RFC3339),
	}
	one := int32(1)
	strandedGw := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name: GatewayName("my-agent"), Namespace: "test-agents",
			Labels: map[string]string{LabelAgent: "my-agent"},
		},
		Spec: appsv1.StatefulSetSpec{Replicas: &one},
	}
	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)

	r, _ := setupReconciler(t, agent, peerSS, strandedGw)
	ctx := context.Background()
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"))
	gw, err := r.client.AppsV1().StatefulSets("test-agents").Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	require.NotNil(t, gw.Spec.Replicas)
	assert.Equal(t, int32(0), *gw.Spec.Replicas)
}

func TestStopRequestedScalesRunningPairDownDespiteActivity(t *testing.T) {
	// The hard stop (#1900) is the one reconciler-side scale-down: user
	// intent overrides fresh activity and an open session pin, takes the
	// pair to zero, and stamps Hibernated. Idempotent on resync.
	agent := agentCR()
	agent.Annotations = map[string]string{
		annLastActivity:  time.Now().UTC().Format(time.RFC3339),
		annActiveSession: "true",
		annStopRequested: time.Now().UTC().Format(time.RFC3339),
	}
	one := int32(1)
	agentSS := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-agent", Namespace: "test-agents",
			Labels: map[string]string{LabelAgent: "my-agent"},
		},
		Spec: appsv1.StatefulSetSpec{Replicas: &one},
	}
	gwOne := int32(1)
	gwSS := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name: GatewayName("my-agent"), Namespace: "test-agents",
			Labels: map[string]string{LabelAgent: "my-agent"},
		},
		Spec: appsv1.StatefulSetSpec{Replicas: &gwOne},
	}

	r, _ := setupReconciler(t, agent, agentSS, gwSS)
	ctx := context.Background()

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"))
	gw, err := r.client.AppsV1().StatefulSets("test-agents").Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *gw.Spec.Replicas)
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonHibernated, cond.Reason)

	// Resync with the stop still standing: no error, still down.
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"))
}

func TestShouldRunStopOverridesEveryRunSignal(t *testing.T) {
	// Stop stickiness is what makes background polls unable to resurrect a
	// stopped agent: it must override fresh activity, an open session pin,
	// AND disabled auto-hibernation ("always run").
	now := time.Now().UTC()
	ann := map[string]string{
		annStopRequested: now.Format(time.RFC3339),
		annActiveSession: "true",
		annLastActivity:  now.Format(time.RFC3339),
	}
	assert.False(t, shouldRun(ann, 0, now), "stop must override always-run")
	assert.False(t, shouldRun(ann, time.Hour, now), "stop must override fresh activity + session pin")

	ann[annStopRequested] = "" // an explicit wake / schedule fire clears it
	assert.True(t, shouldRun(ann, time.Hour, now))
}

func TestParseQuantityOrFallsBackNeverZero(t *testing.T) {
	// The budget must never count an agent at zero: malformed AND
	// non-positive limits fall back to the chart default — mirroring
	// toResourceList's tolerance at render.
	def := resource.MustParse("1")
	for _, in := range []string{"", "garbage", "0", "-2", "0Gi"} {
		q := parseQuantityOr(in, def)
		assert.Equalf(t, 0, q.Cmp(def), "input %q must fall back to the default", in)
	}
	q := parseQuantityOr("500m", def)
	assert.Equal(t, "500m", q.String())
}

func TestToResourceListDropsInvalidQuantities(t *testing.T) {
	// Same tolerance as parseQuantityOr, at the render side: invalid and
	// non-positive quantities are dropped (the caller's default-fill then
	// applies the chart default) instead of panicking the reconcile loop.
	rl := toResourceList(map[string]string{
		"cpu":               "garbage",
		"memory":            "2Gi",
		"ephemeral-storage": "0",
	})
	_, hasCPU := rl[corev1.ResourceCPU]
	assert.False(t, hasCPU)
	mem := rl[corev1.ResourceMemory]
	assert.Equal(t, "2Gi", mem.String())
	_, hasEph := rl[corev1.ResourceName("ephemeral-storage")]
	assert.False(t, hasEph)
}

// upAgentSS is a scaled-up agent StatefulSet whose live template carries the
// currently-running limits — what the live-resize gate diffs against.
func upAgentSS(name, cpu, memory string) *appsv1.StatefulSet {
	one := int32(1)
	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents",
			Labels: map[string]string{LabelAgent: name},
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas: &one,
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{
						Name: AgentContainerName,
						Resources: corev1.ResourceRequirements{
							Limits: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse(cpu),
								corev1.ResourceMemory: resource.MustParse(memory),
							},
						},
					}},
				},
			},
		},
	}
}

func TestResizeGrowOfUpAgentPastCeilingParks(t *testing.T) {
	// The live-resize gate: an up agent's spec grew (0.5 → 1.5 CPU) and no
	// longer fits beside its peer (3 + 1.5 > 4 default ceiling). The pair
	// must park — scale to zero, OverBudget with the figures — instead of
	// rolling a pod at the denied size. This is what makes the controller's
	// enforcement complete without the api-server's synchronous check.
	peer, peerSS := runningPeer("peer", "3", "1Gi")
	agent := ownedAgentCR("my-agent", "1500m", "1Gi") // spec: the GROWN size
	agent.Annotations = map[string]string{
		"agent-platform.ai/last-activity": time.Now().UTC().Format(time.RFC3339),
	}
	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)

	r, _ := setupReconciler(t, agent, peerSS, upAgentSS("my-agent", "500m", "1Gi"))
	ctx := context.Background()
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))

	assert.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"))
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonOverBudget, cond.Reason)
	assert.Contains(t, cond.Message, "shrink")
}

func TestResizeShrinkOfUpAgentNeverParks(t *testing.T) {
	// Grandfathered overshoot: the owner is already past the ceiling
	// (3.9 + 1 > 4). Shrinking the up agent (1 → 0.5 CPU) only helps and
	// must render, never park.
	peer, peerSS := runningPeer("peer", "3900m", "1Gi")
	agent := ownedAgentCR("my-agent", "500m", "512Mi") // spec: the SHRUNK size
	agent.Annotations = map[string]string{
		"agent-platform.ai/last-activity": time.Now().UTC().Format(time.RFC3339),
	}
	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)

	r, _ := setupReconciler(t, agent, peerSS, upAgentSS("my-agent", "1", "1Gi"))
	ctx := context.Background()
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"))
}

func TestResizeUnchangedAgentNeverRecheckedOnCeilingDrop(t *testing.T) {
	// "Nothing is ever evicted because a ceiling changed": the operator
	// drops the owner's ceiling below what's running, but the agent's size
	// didn't change — resyncs must leave it up.
	agent := ownedAgentCR("my-agent", "1500m", "1Gi")
	agent.Annotations = map[string]string{
		"agent-platform.ai/last-activity": time.Now().UTC().Format(time.RFC3339),
	}
	r, _ := setupReconciler(t, agent, upAgentSS("my-agent", "1500m", "1Gi"))
	ctx := context.Background()
	_, err := r.dynamic.Resource(UserBudgetsGVR).Namespace("test-agents").Create(ctx, userBudgetCR("1", "8Gi"), metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"))
}
