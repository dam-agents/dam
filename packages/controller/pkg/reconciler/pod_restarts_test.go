package reconciler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

// TEST_OVERVIEW: The controller publishes the agent pod's restart count on the
func TestPodRestarts_NilAndCleanPod(t *testing.T) {
	restarts, reason := podRestarts(nil)
	assert.Zero(t, restarts)
	assert.Empty(t, reason)

	restarts, reason = podRestarts(readyPod("my-agent-0"))
	assert.Zero(t, restarts, "a pod with no container statuses has not restarted")
	assert.Empty(t, reason)
}

// TEST_SCENARIO: The reason must come from the container that owns the highest
func TestPodRestarts_HighestCountWinsWithItsOwnCause(t *testing.T) {
	pod := readyPod("my-agent-0")
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{
		{
			Name:         "sidecar",
			RestartCount: 1,
			LastTerminationState: corev1.ContainerState{
				Terminated: &corev1.ContainerStateTerminated{ExitCode: 1},
			},
		},
		{
			Name:         "agent",
			RestartCount: 4,
			LastTerminationState: corev1.ContainerState{
				Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled"},
			},
		},
	}

	restarts, reason := podRestarts(pod)
	assert.Equal(t, int32(4), restarts)
	assert.Equal(t, "OutOfMemory", reason)
}

// TEST_SCENARIO: A restart whose last termination exited 0 (or is missing
func TestPodRestarts_CountWithoutAClassifiableCause(t *testing.T) {
	pod := readyPod("my-agent-0")
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{
		{Name: "agent", RestartCount: 2},
	}

	restarts, reason := podRestarts(pod)
	assert.Equal(t, int32(2), restarts)
	assert.Empty(t, reason)
}

// TEST_SCENARIO: The point of publishing the count. A container that crashed and
func TestReconcile_PublishesRestartsOnARecoveredPod(t *testing.T) {
	agent := agentCR()
	pod := readyPod("my-agent-0")
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{
		{
			Name:         "agent",
			RestartCount: 1,
			LastTerminationState: corev1.ContainerState{
				Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled"},
			},
		},
	}
	r, _ := setupReconciler(t, agent, pod, readyPod("my-agent-gateway-0"))

	require.NoError(t, r.Reconcile(context.Background(), agent))

	ready, _ := agentCondition(t, r, "my-agent", apiv1.ConditionAgentPodReady)
	require.Equal(t, string(metav1.ConditionTrue), ready, "the pod recovered")
	restarts, reason := agentRestartStatus(t, r, "my-agent")
	assert.Equal(t, int64(1), restarts)
	assert.Equal(t, "OutOfMemory", reason)
}

func TestReconcile_PublishesZeroRestartsForAHealthyPod(t *testing.T) {
	agent := agentCR()
	r, _ := setupReconciler(t, agent, readyPod("my-agent-0"), readyPod("my-agent-gateway-0"))

	require.NoError(t, r.Reconcile(context.Background(), agent))

	restarts, reason := agentRestartStatus(t, r, "my-agent")
	assert.Zero(t, restarts)
	assert.Empty(t, reason)
}

// TEST_SCENARIO: Hibernation clears the count. The pod it described is gone, and
func TestHibernateAgentPair_ClearsRestarts(t *testing.T) {
	agent := agentCR()
	pod := readyPod("my-agent-0")
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{
		{
			Name:         "agent",
			RestartCount: 3,
			LastTerminationState: corev1.ContainerState{
				Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled"},
			},
		},
	}
	r, client := setupReconciler(t, agent, pod, readyPod("my-agent-gateway-0"))
	require.NoError(t, r.Reconcile(context.Background(), agent))
	restarts, _ := agentRestartStatus(t, r, "my-agent")
	require.Equal(t, int64(3), restarts, "precondition: the count was published")

	require.NoError(t, hibernateAgentPair(
		context.Background(), client, r.dynamic, "test-agents", "my-agent", false,
	))

	restarts, reason := agentRestartStatus(t, r, "my-agent")
	assert.Zero(t, restarts)
	assert.Empty(t, reason)
}

func agentRestartStatus(t *testing.T, r *AgentReconciler, name string) (int64, string) {
	t.Helper()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").
		Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	restarts, _, _ := unstructured.NestedInt64(u.Object, "status", "agentPodRestarts")
	reason, _, _ := unstructured.NestedString(u.Object, "status", "agentPodRestartReason")
	return restarts, reason
}
