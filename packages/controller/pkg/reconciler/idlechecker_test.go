package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
)

func idleCheckerCfg(timeout time.Duration) *config.Config {
	return &config.Config{
		Namespace: "test-agents",
		AgentBase: config.AgentBase{
			IdleTimeout: config.Duration(timeout),
		},
	}
}

func idleAgentCR(name, lastActivity string, annotations map[string]string) *apiv1.Agent {
	if annotations == nil {
		annotations = map[string]string{}
	}
	if lastActivity != "" {
		annotations["agent-platform.ai/last-activity"] = lastActivity
	}
	return &apiv1.Agent{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents", Annotations: annotations,
		},
		Spec: apiv1.AgentSpec{Image: "foo"},
	}
}

func newIdleChecker(t *testing.T, timeout time.Duration, agents []*apiv1.Agent, sts ...runtime.Object) (*IdleChecker, *fake.Clientset) {
	t.Helper()
	dynObjs := make([]runtime.Object, 0, len(agents))
	for _, a := range agents {
		u, err := agentToUnstructured(a)
		require.NoError(t, err)
		dynObjs = append(dynObjs, u)
	}
	client := fake.NewSimpleClientset(sts...)
	return NewIdleChecker(client, newFakeDynamic(dynObjs...), idleCheckerCfg(timeout)), client
}

func agentStatefulSet(name string, replicas int32) *appsv1.StatefulSet {
	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "test-agents",
			Labels:    map[string]string{LabelAgent: name},
		},
		Spec: appsv1.StatefulSetSpec{Replicas: &replicas},
	}
}

func TestIdleChecker_HibernatesIdleInstance(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("idle-agent", staleTime, nil)
	ss := agentStatefulSet("idle-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "idle-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *gotSS.Spec.Replicas, "idle agent scaled to zero")

	u, err := checker.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "idle-agent", metav1.GetOptions{})
	require.NoError(t, err)
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	var readyStatus, readyReason string
	for _, c := range conds {
		if m, ok := c.(map[string]interface{}); ok && m["type"] == apiv1.ConditionReady {
			readyStatus, _ = m["status"].(string)
			readyReason, _ = m["reason"].(string)
		}
	}
	assert.Equal(t, string(metav1.ConditionFalse), readyStatus, "hibernated agent must report Ready=False")
	assert.Equal(t, apiv1.ReasonHibernated, readyReason, "hibernated agent must carry the Hibernated reason")
}

func TestIdleChecker_SkipsRecentlyActiveInstance(t *testing.T) {
	recentTime := time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339)
	agent := idleAgentCR("active-agent", recentTime, nil)
	ss := agentStatefulSet("active-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "active-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *gotSS.Spec.Replicas, "recently-active agent stays running")
}

func TestIdleChecker_SkipsActiveSession(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("session-agent", staleTime, map[string]string{
		"agent-platform.ai/active-session": "true",
	})
	ss := agentStatefulSet("session-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "session-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *gotSS.Spec.Replicas, "agent with an active session stays running")
}

func TestIdleChecker_SkipsNoLastActivity(t *testing.T) {
	agent := idleAgentCR("new-agent", "", nil)
	ss := agentStatefulSet("new-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "new-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *gotSS.Spec.Replicas, "agent with no activity stamp fails open and stays running")
}

func TestIdleChecker_SkipsBusyAgent(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("busy-agent", staleTime, nil)
	ss := agentStatefulSet("busy-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)
	checker.busyProbe = func(context.Context, string) bool { return true }

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "busy-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *gotSS.Spec.Replicas, "busy agent must stay running even when idle by activity")
}

// TEST_SCENARIO: Hibernating an agent already scaled to zero leaves it there.
func TestIdleChecker_HibernatingAZeroedAgentIsIdempotent(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("hibernated-agent", staleTime, nil)
	ss := agentStatefulSet("hibernated-agent", 0)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "hibernated-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *gotSS.Spec.Replicas, "already-hibernated agent stays at zero (idempotent)")
}

func hibernatedCondition() []metav1.Condition {
	return []metav1.Condition{{
		Type:               apiv1.ConditionReady,
		Status:             metav1.ConditionFalse,
		Reason:             apiv1.ReasonHibernated,
		LastTransitionTime: metav1.Now(),
	}}
}

// TEST_SCENARIO: An agent at zero that already reports hibernated has no work left, so it is skipped.
func TestIdleChecker_SkipsAgentAtZeroAndReportedHibernated(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("sleeping-agent", staleTime, nil)
	agent.Status.Conditions = hibernatedCondition()
	ss := agentStatefulSet("sleeping-agent", 0)
	checker, _ := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)
	probed := false
	checker.busyProbe = func(context.Context, string) bool { probed = true; return false }

	checker.check(context.Background())

	assert.False(t, probed, "a sleeping agent must not be probed or re-hibernated")
}

// TEST_SCENARIO: An agent held at zero without hibernation published still needs its status flipped.
func TestIdleChecker_HibernatesAgentAtZeroWithoutPublishedHibernation(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("parked-agent", staleTime, nil)
	ss := agentStatefulSet("parked-agent", 0)
	checker, _ := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)
	probed := false
	checker.busyProbe = func(context.Context, string) bool { probed = true; return false }

	checker.check(context.Background())

	assert.True(t, probed, "an agent whose status has not caught up must still be swept")
}

// TEST_SCENARIO: A running pod is reaped even when its status wrongly reads hibernated.
func TestIdleChecker_HibernatesRunningAgentDespiteHibernatedStatus(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("mislabelled-agent", staleTime, nil)
	agent.Status.Conditions = hibernatedCondition()
	ss := agentStatefulSet("mislabelled-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	got, err := client.AppsV1().
		StatefulSets("test-agents").
		Get(context.Background(), "mislabelled-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *got.Spec.Replicas, "a running pod must be reaped whatever its status says")
}

func TestIdleChecker_CheckInterval(t *testing.T) {
	tests := []struct {
		timeout  time.Duration
		expected time.Duration
	}{
		{1 * time.Hour, 5 * time.Minute},
		{3 * time.Minute, 30 * time.Second},
		{15 * time.Minute, 2*time.Minute + 30*time.Second},
	}
	for _, tt := range tests {
		checker := NewIdleChecker(nil, nil, idleCheckerCfg(tt.timeout))
		assert.Equal(t, tt.expected, checker.checkInterval(), "timeout=%v", tt.timeout)
	}
}

func withHibernationTimeout(agent *apiv1.Agent, d time.Duration) *apiv1.Agent {
	agent.Spec.HibernationTimeout = &metav1.Duration{Duration: d}
	return agent
}

// TEST_SCENARIO: An agent that sets a one-minute hibernation timeout must be swept inside its own window, so the sweep cadence follows the shortest per-agent timeout in play, not the chart-wide one.
func TestIdleChecker_CheckIntervalFollowsShortestAgentTimeout(t *testing.T) {
	recentTime := time.Now().UTC().Add(-10 * time.Second).Format(time.RFC3339)
	agent := withHibernationTimeout(idleAgentCR("quick-agent", recentTime, nil), time.Minute)
	ss := agentStatefulSet("quick-agent", 1)
	checker, _ := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	assert.Equal(t, 5*time.Minute, checker.checkInterval(), "before any sweep the chart-wide default sets the cadence")

	checker.check(context.Background())

	assert.Equal(t, 15*time.Second, checker.checkInterval(), "a one-minute agent must be swept inside its own window")
}

// TEST_SCENARIO: An agent past its own short timeout hibernates even though the chart-wide default is far longer, which is the case the one-minute setting exercises.
func TestIdleChecker_HibernatesByShortPerAgentTimeout(t *testing.T) {
	staleTime := time.Now().UTC().Add(-5 * time.Minute).Format(time.RFC3339)
	agent := withHibernationTimeout(idleAgentCR("minute-agent", staleTime, nil), time.Minute)
	ss := agentStatefulSet("minute-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "minute-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *gotSS.Spec.Replicas, "an agent past its own timeout hibernates whatever the chart-wide default says")
}

// TEST_SCENARIO: An install whose chart-wide default never hibernates still has to serve agents that set their own positive timeout, so the sweep keeps running and honours the override.
func TestIdleChecker_ServesOverridesWhenGlobalTimeoutIsZero(t *testing.T) {
	staleTime := time.Now().UTC().Add(-5 * time.Minute).Format(time.RFC3339)
	agent := withHibernationTimeout(idleAgentCR("opt-in-agent", staleTime, nil), time.Minute)
	ss := agentStatefulSet("opt-in-agent", 1)
	checker, client := newIdleChecker(t, 0, []*apiv1.Agent{agent}, ss)

	assert.Equal(t, 5*time.Minute, checker.checkInterval(), "with nothing observed yet the sweep still runs, at its slowest cadence")

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "opt-in-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *gotSS.Spec.Replicas, "an opted-in agent hibernates even when the install defaults to always-on")
	assert.Equal(t, 15*time.Second, checker.checkInterval(), "the observed override sets the cadence when the install has none")
}

// TEST_SCENARIO: A restart forgets what the last sweep observed, so the run loop must sweep once before its first tick; otherwise a one-minute agent waits out the chart-wide cadence and the reported bug returns on every restart.
func TestIdleChecker_RunLoopSweepsBeforeFirstTick(t *testing.T) {
	staleTime := time.Now().UTC().Add(-5 * time.Minute).Format(time.RFC3339)
	agent := withHibernationTimeout(idleAgentCR("minute-agent", staleTime, nil), time.Minute)
	ss := agentStatefulSet("minute-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stopped := make(chan struct{})
	go func() {
		checker.RunLoop(ctx)
		close(stopped)
	}()

	require.Eventually(t, func() bool {
		gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "minute-agent", metav1.GetOptions{})
		return err == nil && *gotSS.Spec.Replicas == 0
	}, 2*time.Second, 10*time.Millisecond,
		"the first tick is five minutes away, so only a sweep before it can hibernate this agent")

	assert.Equal(t, 15*time.Second, checker.checkInterval(),
		"the sweep before the first tick also seeds the cadence from the agent's own timeout")

	cancel()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("idle checker did not stop when its context was cancelled")
	}
}

// TEST_SCENARIO: The run loop used to shut itself down on an always-on install, which left every per-agent timeout unserved, so it must stay up and stop only when its context is cancelled.
func TestIdleChecker_RunLoopStaysUpWhenGlobalTimeoutIsZero(t *testing.T) {
	agent := withHibernationTimeout(idleAgentCR("opt-in-agent", "", nil), time.Minute)
	checker, _ := newIdleChecker(t, 0, []*apiv1.Agent{agent})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stopped := make(chan struct{})
	go func() {
		checker.RunLoop(ctx)
		close(stopped)
	}()

	select {
	case <-stopped:
		t.Fatal("idle checker exited although agents can set their own hibernation timeout")
	case <-time.After(50 * time.Millisecond):
	}

	cancel()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("idle checker did not stop when its context was cancelled")
	}
}

// TEST_SCENARIO: A zero per-agent timeout means never hibernate, and such an agent must not drag the sweep cadence down either.
func TestIdleChecker_ZeroPerAgentTimeoutNeverHibernates(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := withHibernationTimeout(idleAgentCR("always-on-agent", staleTime, nil), 0)
	ss := agentStatefulSet("always-on-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "always-on-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *gotSS.Spec.Replicas, "an always-on agent keeps running however long it sits idle")
	assert.Equal(t, 5*time.Minute, checker.checkInterval(), "an always-on agent does not speed the sweep up")
}
