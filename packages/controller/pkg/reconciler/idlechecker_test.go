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

// idleAgentCR builds an Agent CR carrying activity annotations — the only
// inputs the idle checker reads (ADR-058).
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

// newIdleChecker wires a checker over a typed fake (StatefulSets) and a dynamic
// fake seeded with the given Agent CRs.
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

// agentStatefulSet is a stand-in for the agent (or gateway) StatefulSet the
// controller renders, labelled so the idle checker's scale-down selects it.
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

	// Pods are gone, so the agent is not routable — Ready must reflect that,
	// with the Hibernated reason that tells it apart from a still-starting agent.
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
	// An idle-by-activity agent that the pod probe reports BUSY (active
	// session/trigger/terminal) must not be hibernated — this guard is the
	// reason scale-down lives in the idle checker, not the reconciler (ADR-058).
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("busy-agent", staleTime, nil)
	ss := agentStatefulSet("busy-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)
	checker.busyProbe = func(string) bool { return true }

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "busy-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *gotSS.Spec.Replicas, "busy agent must stay running even when idle by activity")
}

func TestIdleChecker_SkipsAlreadyHibernated(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("hibernated-agent", staleTime, nil)
	ss := agentStatefulSet("hibernated-agent", 0)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "hibernated-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *gotSS.Spec.Replicas, "already-hibernated agent stays at zero (idempotent)")
}

func TestIdleChecker_CheckInterval(t *testing.T) {
	tests := []struct {
		timeout  time.Duration
		expected time.Duration
	}{
		{1 * time.Hour, 5 * time.Minute},                   // 10m clamped to 5m
		{3 * time.Minute, 30 * time.Second},                // 30s clamped to 30s
		{15 * time.Minute, 2*time.Minute + 30*time.Second}, // 2m30s within range
	}
	for _, tt := range tests {
		checker := NewIdleChecker(nil, nil, idleCheckerCfg(tt.timeout))
		assert.Equal(t, tt.expected, checker.checkInterval(), "timeout=%v", tt.timeout)
	}
}
