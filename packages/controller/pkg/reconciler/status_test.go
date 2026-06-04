package reconciler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

func TestUpdateAgentStatus_PublishesCondition(t *testing.T) {
	u, err := agentToUnstructured(&apiv1.Agent{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent", Namespace: "test-agents"},
	})
	require.NoError(t, err)
	dyn := newFakeDynamic(u)

	require.NoError(t, updateAgentStatus(context.Background(), dyn, "test-agents", "my-agent", func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReady, true, "AllPodsReady", "PodsNotReady", "", 2)
		s.ObservedGeneration = 2
	}))

	got, err := dyn.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	conds, _, _ := unstructured.NestedSlice(got.Object, "status", "conditions")
	require.Len(t, conds, 1)
	ready := conds[0].(map[string]interface{})
	assert.Equal(t, apiv1.ConditionReady, ready["type"])
	assert.Equal(t, string(metav1.ConditionTrue), ready["status"])
}

func TestUpdateAgentStatus_ReconcileError(t *testing.T) {
	u, err := agentToUnstructured(&apiv1.Agent{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent", Namespace: "test-agents"},
	})
	require.NoError(t, err)
	dyn := newFakeDynamic(u)

	require.NoError(t, updateAgentStatus(context.Background(), dyn, "test-agents", "my-agent", func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReconciled, false, "Reconciled", "ReconcileError", "boom", 0)
	}))

	got, err := dyn.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	conds, _, _ := unstructured.NestedSlice(got.Object, "status", "conditions")
	require.Len(t, conds, 1)
	reconciled := conds[0].(map[string]interface{})
	assert.Equal(t, string(metav1.ConditionFalse), reconciled["status"])
	assert.Equal(t, "boom", reconciled["message"])
}

func TestUpdateAgentStatus_NoOpWhenUnchanged(t *testing.T) {
	u, err := agentToUnstructured(&apiv1.Agent{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent", Namespace: "test-agents"},
	})
	require.NoError(t, err)
	dyn := newFakeDynamic(u)

	mutate := func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", "PodsNotReady", "", 1)
		s.ObservedGeneration = 1
	}
	require.NoError(t, updateAgentStatus(context.Background(), dyn, "test-agents", "my-agent", mutate))
	after1, err := dyn.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	rv1 := after1.GetResourceVersion()

	// Re-applying the identical observation must be a no-op — no write, so no
	// resourceVersion bump (load-bearing: a write would re-trigger reconcile).
	require.NoError(t, updateAgentStatus(context.Background(), dyn, "test-agents", "my-agent", mutate))
	after2, err := dyn.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, rv1, after2.GetResourceVersion(), "redundant status update must not write")
}

func TestUpdateAgentStatus_NotFound(t *testing.T) {
	dyn := newFakeDynamic()
	err := updateAgentStatus(context.Background(), dyn, "test-agents", "missing", func(s *apiv1.AgentStatus) {
		s.ObservedGeneration = 1
	})
	assert.Error(t, err)
}
