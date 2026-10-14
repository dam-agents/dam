package reconciler

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// TEST_OVERVIEW: A crash-looping agent whose home volume is full must be published as HomeVolumeFull, both while it waits to restart and as the restart cause, because a generic ContainerTerminated gives its owner no way to tell a full disk from any other crash.
func crashLoopingPod(message string) *corev1.Pod {
	pod := readyPod("my-agent-0")
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:         "agent",
		RestartCount: 3,
		State: corev1.ContainerState{
			Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"},
		},
		LastTerminationState: corev1.ContainerState{
			Terminated: &corev1.ContainerStateTerminated{ExitCode: 1, Reason: "Error", Message: message},
		},
	}}
	return pod
}

func TestTerminationReason_HomeVolumeFullFromTheTerminationMessage(t *testing.T) {
	pod := crashLoopingPod("HomeVolumeFull\n")

	reason, message, ok := terminationReason(pod)
	assert.True(t, ok)
	assert.Equal(t, apiv1.ReasonHomeVolumeFull, reason)
	assert.Contains(t, message, "home volume is full")

	_, restartReason := podRestarts(pod)
	assert.Equal(t, apiv1.ReasonHomeVolumeFull, restartReason)
}

// TEST_SCENARIO: Any other termination message keeps the generic cause, so a container that writes its own text there is never mistaken for a full disk.
func TestTerminationReason_OtherMessagesStayContainerTerminated(t *testing.T) {
	for _, message := range []string{"", "panic: boom", "HomeVolumeFull is a lie"} {
		reason, _, ok := terminationReason(crashLoopingPod(message))
		assert.True(t, ok)
		assert.Equal(t, "ContainerTerminated", reason, "message %q", message)
	}
}

// TEST_SCENARIO: an OOM kill of the runner takes every machine of its owner down at once, so each agent it took down carries the reason until it is ready again. An agent that came up after the kill, one that was not ready when it happened, one that is stopping, or a runner that restarted for another reason carries nothing, since the kill is not what keeps it down.
func TestARunnerOOMKillIsBlamedOnlyOnTheAgentsItTookDown(t *testing.T) {
	killed := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	runner := &corev1.Pod{Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{
		Name: vmRunnerComponent,
		LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
			Reason: "OOMKilled", FinishedAt: metav1.NewTime(killed),
		}},
	}}}}
	assert.Equal(t, killed, runnerOOMKilledAt(runner))
	runner.Status.ContainerStatuses[0].LastTerminationState.Terminated.Reason = "Error"
	assert.True(t, runnerOOMKilledAt(runner).IsZero(), "a restart that was not an OOM kill")

	ready := func(at time.Time) *metav1.Condition {
		return &metav1.Condition{Type: apiv1.ConditionAgentPodReady, Status: metav1.ConditionTrue, LastTransitionTime: metav1.NewTime(at)}
	}
	at := func() time.Time { return killed }
	never := func() time.Time { return time.Time{} }
	carried := &metav1.Condition{Type: apiv1.ConditionAgentPodReady, Status: metav1.ConditionFalse, Reason: apiv1.ReasonRunnerOutOfMemory}

	assert.True(t, runnerOOMTookDown(ready(killed.Add(-time.Hour)), true, false, at), "ready before the kill")
	assert.True(t, runnerOOMTookDown(carried, true, false, never), "the reason lasts through the boot")
	assert.False(t, runnerOOMTookDown(carried, true, true, at), "ready again")
	assert.False(t, runnerOOMTookDown(carried, false, false, at), "the agent is stopping")
	assert.False(t, runnerOOMTookDown(ready(killed.Add(time.Minute)), true, false, at), "ready only after the kill")
	assert.False(t, runnerOOMTookDown(ready(killed.Add(-time.Hour)), true, false, never), "no kill")
	assert.False(t, runnerOOMTookDown(&metav1.Condition{Status: metav1.ConditionFalse, Reason: apiv1.ReasonHibernated}, true, false, at), "woken from hibernation")
}
