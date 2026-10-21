package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

// TEST_SCENARIO: the runner pod records an OOM kill of its runner container, finished at the given time.
func killTheRunnerForMemory(t *testing.T, r *AgentReconciler, at time.Time) {
	t.Helper()
	pods := r.client.CoreV1().Pods("test-agents")
	runner, err := pods.Get(context.Background(), readyRunnerPod().Name, metav1.GetOptions{})
	require.NoError(t, err)
	runner.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name: vmRunnerComponent,
		LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
			Reason: "OOMKilled", FinishedAt: metav1.NewTime(at),
		}},
	}}
	_, err = pods.UpdateStatus(context.Background(), runner, metav1.UpdateOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: an OOM kill of the runner takes every machine of its owner down at once — the runner pod is the cgroup, and the VMMs of all its machines live in it — so it explains every agent that was running when it landed, whatever reason the restarted runner gives it afterwards. The report is read from two persisted facts and no clock of its own: the kill the runner pod records, and what the agent's AgentPodReady last said, dated to the kill by the publish that named it.
func TestARunnerOOMKillExplainsEveryAgentItTookDown(t *testing.T) {
	now := time.Now()
	killed := now.Add(-time.Minute).Truncate(time.Second)
	kill := runnerKill{ID: "runner-pod/containerd://abc@1", At: killed}

	cond := func(status metav1.ConditionStatus, reason string, at time.Time) *metav1.Condition {
		return &metav1.Condition{Type: apiv1.ConditionAgentPodReady, Status: status, Reason: reason, LastTransitionTime: metav1.NewTime(at)}
	}
	explains := func(c *metav1.Condition, k runnerKill) bool {
		if c == nil {
			return killExplainsAgent(nil, k, now)
		}
		return killExplainsAgent([]metav1.Condition{*c}, k, now)
	}

	// TEST_SCENARIO: the agent was up when the kill landed, so it names the kill while the episode lasts.
	assert.True(t, explains(cond(metav1.ConditionTrue, "PodReady", killed.Add(-time.Hour)), kill), "up when the kill landed")
	// TEST_SCENARIO: the agent already names the kill, dated to the kill by the publish that named it: repeated reconciles cannot extend the ten minutes, whichever reason the agent carries on Ready.
	assert.True(t, explains(cond(metav1.ConditionFalse, apiv1.ReasonRunnerOutOfMemory, killed), kill), "named at the kill's own time")
	assert.True(t, explains(cond(metav1.ConditionFalse, apiv1.ReasonRunnerOutOfMemory, killed), runnerKill{}), "named, whose kill the restarted runner no longer records")
	expiredAt := killed.Add(-runnerOOMEpisode - 30*time.Second)
	expired := cond(metav1.ConditionFalse, apiv1.ReasonRunnerOutOfMemory, expiredAt)
	assert.False(t, explains(expired, runnerKill{}), "named by a kill the restarted runner no longer records, past the episode")
	// TEST_SCENARIO: a second kill of the runner opens its own episode on an agent the first has not released.
	assert.True(t, explains(expired, runnerKill{ID: "second", At: killed}), "a second kill, named over the expired reason of the first")

	// TEST_SCENARIO: an agent already down when the kill landed was not taken down by it: one the idle checker put to sleep before it, one whose start was already refused.
	assert.False(t, explains(cond(metav1.ConditionFalse, apiv1.ReasonHibernated, killed.Add(-time.Hour)), kill), "asleep when the kill landed")
	assert.False(t, explains(cond(metav1.ConditionFalse, apiv1.ReasonOverBudget, killed.Add(-time.Minute)), kill), "refused room before the kill landed")
	// TEST_SCENARIO: an agent put to sleep or refused room after the kill was up through it, so the kill is what took its machine down.
	assert.True(t, explains(cond(metav1.ConditionFalse, apiv1.ReasonHibernated, killed.Add(time.Minute)), kill), "reclaimed after the kill")
	assert.True(t, explains(cond(metav1.ConditionFalse, apiv1.ReasonOverBudget, killed.Add(time.Minute)), kill), "refused room by the restarted runner")
	// TEST_SCENARIO: an agent woken and refused room after the kill published that refusal after it, so the kill explains it too, since every machine of the owner lived in the killed pod.
	assert.True(t, explains(cond(metav1.ConditionTrue, "PodReady", killed.Add(30*time.Second)), kill), "up again after the kill")
	// TEST_SCENARIO: nothing else explains an agent.
	assert.False(t, explains(nil, kill), "an agent that never published readiness")
	assert.False(t, explains(cond(metav1.ConditionTrue, "PodReady", killed.Add(-time.Hour)), runnerKill{}), "no kill")
	assert.False(t, explains(cond(metav1.ConditionTrue, "PodReady", killed.Add(-time.Hour)), runnerKill{ID: "old", At: now.Add(-runnerOOMEpisode - time.Minute)}), "a kill older than the episode")
}

// TEST_SCENARIO: two kills of one owner's runner are told apart by the container that died and the time it finished, so a second kill opens its own episode rather than being read as the first one still in the pod's history.
func TestASecondKillOfTheRunnerIsItsOwn(t *testing.T) {
	now := time.Now()
	first, second := now.Add(-20*time.Minute), now.Add(-time.Minute)
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "runner-pod"}, Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{
		Name:                 vmRunnerComponent,
		ContainerID:          "containerd://second",
		LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled", FinishedAt: metav1.NewTime(second)}},
	}}}}
	kill := runnerOOMKillOf(pod)
	assert.Equal(t, second, kill.At)
	assert.NotEqual(t, pod.Name+"/containerd://first@"+first.UTC().Format(time.RFC3339), kill.ID)
	assert.Equal(t, pod.Name+"/containerd://second@"+second.UTC().Format(time.RFC3339), kill.ID)

	// TEST_SCENARIO: the pod is restarted after the second kill and only carries the first in its history until the new container dies: the older kill is what the pod reports, so the episode of the newer one is read from the newer one alone.
	pod.Status.ContainerStatuses[0] = corev1.ContainerStatus{
		Name:                 vmRunnerComponent,
		ContainerID:          "containerd://third",
		State:                corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
		LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled", FinishedAt: metav1.NewTime(second)}},
	}
	assert.Equal(t, second, runnerOOMKillOf(pod).At)
}
