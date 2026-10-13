package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	corev1 "k8s.io/api/core/v1"

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
