package reconciler

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
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

// TEST_SCENARIO: an OOM kill of the runner takes every machine of its owner down at once — the runner pod is the cgroup, and the VMMs of all its machines live in it — so every agent that was already running names the kill while the episode lasts, whatever reason the restarted runner reports for it afterwards: a refused start for room, a reclaim, a boot the restart broke, or a machine the kernel killed again. The report ends with the episode window, so a boot that keeps failing after it is seen as the failure it is, and an agent that is up, asleep, woken after the kill, or stopping carries nothing.
func TestARunnerOOMKillIsBlamedOnEveryAgentThatShouldRun(t *testing.T) {
	now := time.Now()
	killed := now.Add(-time.Minute)
	runner := &corev1.Pod{Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{
		Name: vmRunnerComponent,
		LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
			Reason: "OOMKilled", FinishedAt: metav1.NewTime(killed),
		}},
	}}}}
	assert.Equal(t, killed, runnerOOMKilledAt(runner))
	runner.Status.ContainerStatuses[0].LastTerminationState.Terminated.Reason = "Error"
	assert.True(t, runnerOOMKilledAt(runner).IsZero(), "a restart that was not an OOM kill")

	down := func(reason string) *metav1.Condition {
		return &metav1.Condition{Type: apiv1.ConditionAgentPodReady, Status: metav1.ConditionFalse, Reason: reason, LastTransitionTime: metav1.NewTime(killed.Add(time.Second))}
	}
	up := &metav1.Condition{Type: apiv1.ConditionAgentPodReady, Status: metav1.ConditionTrue, LastTransitionTime: metav1.NewTime(killed.Add(-time.Hour))}
	at := func() time.Time { return killed }
	aged := func() time.Time { return now.Add(-runnerOOMEpisode - time.Minute) }
	stale := down(apiv1.ReasonRunnerOutOfMemory)
	stale.LastTransitionTime = metav1.NewTime(aged())
	never := func() time.Time { return time.Time{} }
	// TEST_SCENARIO: the agent was already awake when the kill landed, and the second woke after it.
	runningAt := func() time.Time { return killed.Add(-time.Hour) }
	wokenAt := func() time.Time { return killed.Add(time.Minute) }

	assert.True(t, runnerOOMTookDown(up, true, false, runningAt, at), "ready at the kill, down now")
	assert.True(t, runnerOOMTookDown(down(apiv1.ReasonOverBudget), true, false, runningAt, at), "refused room by the restarted runner")
	assert.True(t, runnerOOMTookDown(down(apiv1.ReasonHibernated), true, false, runningAt, at), "reclaimed after the kill")
	assert.True(t, runnerOOMTookDown(down(vmrunner.ReasonBootFailed), true, false, runningAt, at), "a boot the restart broke")
	assert.True(t, runnerOOMTookDown(down(vmrunner.ReasonOOMKilled), true, false, runningAt, at), "a machine killed again")
	assert.True(t, runnerOOMTookDown(down(apiv1.ReasonRunnerOutOfMemory), true, false, runningAt, never), "the reason lasts through the runner's own restart")
	assert.True(t, runnerOOMTookDown(down(apiv1.ReasonRunnerOutOfMemory), true, false, never, never), "an agent that was down before the kill, its start unknown to this controller")
	assert.False(t, runnerOOMTookDown(up, true, true, runningAt, at), "up again")
	assert.False(t, runnerOOMTookDown(up, false, false, runningAt, at), "asleep when the kill happened")
	assert.False(t, runnerOOMTookDown(up, true, false, wokenAt, at), "woken inside the episode, which the kill did not take down")
	assert.False(t, runnerOOMTookDown(down(apiv1.ReasonRunnerOutOfMemory), true, false, wokenAt, never), "woken inside the episode, carrying the reason from a start that failed under it")
	assert.False(t, runnerOOMTookDown(up, true, false, runningAt, never), "no kill")
	assert.False(t, runnerOOMTookDown(up, true, false, runningAt, aged), "a kill older than the episode")
	assert.False(t, runnerOOMTookDown(stale, true, false, runningAt, never), "a reason carried past the episode")
	assert.False(t, runnerOOMTookDown(nil, true, false, runningAt, at), "an agent that never published readiness")
}
