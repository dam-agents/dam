package reconciler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// TEST_OVERVIEW: nesting is asked for per Agent, through spec.backend.vm.nestedVirtualization, and granted per machine. The controller forwards the ask to the owner's runner only on an install that lets runners nest, leaves every other machine of that runner without it, and tells the owner on the NestedVirtualization condition whether the machine got it.

func nestingAgent() *apiv1.Agent {
	agent := vmAgentCR()
	agent.Spec.Backend.VM = &apiv1.VMBackend{NestedVirtualization: true}
	return agent
}

func readNestingCondition(t *testing.T, r *AgentReconciler, name string) map[string]interface{} {
	t.Helper()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	for _, c := range conds {
		if m, ok := c.(map[string]interface{}); ok && m["type"] == apiv1.ConditionNestedVirtualization {
			return m
		}
	}
	return nil
}

// TEST_SCENARIO: an install that does not let runners nest never sends the ask on, so a runner it rendered without the nesting flag is never asked for what it cannot give. The owner who asked still hears why the machine boots without it.
func TestAnAgentAskingToNestOnAnInstallThatForbidsItIsToldWhy(t *testing.T) {
	agent := nestingAgent()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.False(t, node.spec("my-agent").NestedVirtualization)
	cond := readNestingCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, "False", cond["status"])
	assert.Equal(t, "NotAllowedByInstall", cond["reason"])
}

// TEST_SCENARIO: on an install that lets runners nest, the Agent's ask reaches its machine, and the condition follows what the runner reports: not yet while the machine has not booted with it, Enabled once it has, and NodeCannotNest when the runner booted it without, because the node's KVM does not allow nesting.
func TestAnAgentAskingToNestGetsItWhereTheRunnerGrantsIt(t *testing.T) {
	agent := nestingAgent()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.NestedVirtualization = true
	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.True(t, node.spec("my-agent").NestedVirtualization)

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true, Nested: true})
	require.NoError(t, r.Reconcile(context.Background(), agent))
	cond := readNestingCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, "True", cond["status"])
	assert.Equal(t, "Enabled", cond["reason"])

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
	require.NoError(t, r.Reconcile(context.Background(), agent))
	cond = readNestingCondition(t, r, "my-agent")
	assert.Equal(t, "False", cond["status"])
	assert.Equal(t, "NodeCannotNest", cond["reason"])
}

// TEST_SCENARIO: an Agent that does not ask gets no nesting even on an install that allows it, so its siblings' choice never reaches its machine, and it carries no NestedVirtualization condition at all. One that stops asking loses the condition with the nesting.
func TestAnAgentThatDoesNotAskNeitherNestsNorCarriesTheCondition(t *testing.T) {
	agent := nestingAgent()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.NestedVirtualization = true
	require.NoError(t, r.Reconcile(context.Background(), agent))
	require.NotNil(t, readNestingCondition(t, r, "my-agent"))

	agent.Spec.Backend.VM = nil
	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.False(t, node.spec("my-agent").NestedVirtualization)
	assert.Nil(t, readNestingCondition(t, r, "my-agent"))
}
