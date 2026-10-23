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

// TEST_SCENARIO: the same termination names the same kill before and after the runner container restarts, because the name is the terminated container's own id and finished time: a kill read from the live state and one read from the last termination are one kill, so an agent attributed it is never told about it again.
func TestOneKillKeepsOneNameAcrossTheContainersRestart(t *testing.T) {
	at := time.Now().Add(-time.Minute).Truncate(time.Second)
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "runner"}, Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{
		Name:        vmRunnerComponent,
		ContainerID: "containerd://dead",
		State:       corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled", FinishedAt: metav1.NewTime(at), ContainerID: "containerd://dead"}},
	}}}}
	before := runnerOOMKillOf(pod)
	require.Equal(t, at, before.At)

	// TEST_SCENARIO: the pod restarts its runner, so the kill is only its last termination now, and the container id on the status is the new one.
	pod.Status.ContainerStatuses[0] = corev1.ContainerStatus{
		Name:                 vmRunnerComponent,
		ContainerID:          "containerd://new",
		State:                corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
		LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled", FinishedAt: metav1.NewTime(at), ContainerID: "containerd://dead"}},
	}
	assert.Equal(t, before.ID, runnerOOMKillOf(pod).ID, "the same terminated container names the same kill")
}

// TEST_SCENARIO: two kills of one owner's runner are told apart by the container that died and the time it finished, so a second kill opens its own episode rather than being read as the first one still in the pod's history.
func TestASecondKillOfTheRunnerIsItsOwn(t *testing.T) {
	now := time.Now()
	first, second := now.Add(-20*time.Minute), now.Add(-time.Minute)
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "runner"}, Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{
		Name:                 vmRunnerComponent,
		ContainerID:          "containerd://second",
		LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled", FinishedAt: metav1.NewTime(second), ContainerID: "containerd://second"}},
	}}}}
	kill := runnerOOMKillOf(pod)
	assert.Equal(t, second, kill.At)
	assert.Equal(t, "containerd://second@"+second.UTC().Format(time.RFC3339), kill.ID)

	// TEST_SCENARIO: a kill that was not an OOM kill names nothing.
	pod.Status.ContainerStatuses[0].LastTerminationState.Terminated.Reason = "Error"
	assert.True(t, runnerOOMKillOf(pod).IsZero(), "a restart that was not an OOM kill")
	assert.NotEqual(t, "containerd://first@"+first.UTC().Format(time.RFC3339), kill.ID)
}

// TEST_SCENARIO: a kill goes only to an agent whose machine was holding memory on that runner at the kill, read from the two stamps the controller writes as it watches the machine. A machine started after the kill is no victim; one booting, running or stopping at it is; one a reclaim put to sleep after it is, since its start went before the kill and its end did not; one seen stopped before the kill is not; and one whose start went before the platform wrote any stamp is a victim unless the agent itself is younger than the kill or a stop of it was seen before the kill. A stamp inside the kill's own second is an event from before the kill, since only the runner the kill took down answers in it.
func TestAKillGoesOnlyToMachinesThatWereOnTheRunner(t *testing.T) {
	killed := time.Now().Add(-time.Minute).Truncate(time.Second)
	stamped := func(up, down time.Time) *apiv1.Agent {
		agent := &apiv1.Agent{}
		agent.Annotations = map[string]string{}
		if !up.IsZero() {
			agent.Annotations[annMachineUp] = up.Format(time.RFC3339Nano)
		}
		if !down.IsZero() {
			agent.Annotations[annMachineDown] = down.Format(time.RFC3339Nano)
		}
		return agent
	}
	assert.True(t, machineOccupiedAt(stamped(killed.Add(-time.Hour), time.Time{}), killed), "booting or running at the kill")
	assert.True(t, machineOccupiedAt(stamped(killed.Add(-time.Hour), killed.Add(time.Minute)), killed), "put to sleep after the kill")
	assert.False(t, machineOccupiedAt(stamped(killed.Add(-time.Hour), killed.Add(-time.Second)), killed), "seen stopped before the kill")
	assert.False(t, machineOccupiedAt(stamped(killed.Add(time.Minute), time.Time{}), killed), "started after the kill")
	assert.True(t, machineOccupiedAt(stamped(killed, time.Time{}), killed), "began holding memory in the kill's own second")
	assert.False(t, machineOccupiedAt(stamped(killed, killed), killed), "stopped in the kill's own second")
	assert.True(t, machineOccupiedAt(stamped(time.Time{}, time.Time{}), killed), "a machine whose start went before the platform wrote the stamps")
	assert.False(t, machineOccupiedAt(stamped(time.Time{}, killed.Add(-time.Second)), killed), "one of those, seen stopped before the kill")

	// TEST_SCENARIO: an agent created after the kill had no machine of it on the runner, so its absent stamps mean nothing, and one created in the kill's own second is read the same way: a creation is no runner's answer, so a boot it had before the kill would have been stamped.
	for _, created := range []time.Time{killed.Add(time.Second), killed} {
		younger := stamped(time.Time{}, time.Time{})
		younger.CreationTimestamp = metav1.NewTime(created)
		assert.False(t, machineOccupiedAt(younger, killed), "an agent created at %s", created.Format(time.RFC3339Nano))
	}
}

// TEST_SCENARIO: a kill ends for an agent once its machine answered ready after it, which is the kill named in the end mark, or once the ten minutes the kill explains have passed: both are durable, so the reason never comes back to that agent however long the runner keeps the termination and whatever its machine does next. The mark names the kill rather than a time, so a controller clock apart from the node's reads the same answer.
func TestAKillEndsForAnAgentThatAnsweredOrWhoseEpisodeIsOver(t *testing.T) {
	killed := time.Now().Add(-time.Minute).Truncate(time.Second)
	kill := runnerKill{ID: "containerd://dead@" + killed.UTC().Format(time.RFC3339), At: killed}
	agent := func(over string) *apiv1.Agent {
		a := &apiv1.Agent{}
		a.Annotations = map[string]string{}
		if over != "" {
			a.Annotations[annRunnerOOMDone] = over
		}
		return a
	}
	assert.False(t, killIsOver(agent(""), kill, time.Now()), "still inside its episode")
	assert.True(t, killIsOver(agent(kill.ID), kill, time.Now()), "the machine answered after the kill")
	assert.False(t, killIsOver(agent("containerd://other@"+killed.UTC().Format(time.RFC3339)), kill, time.Now()), "an answer that ended another kill does not end this one")
	assert.True(t, killIsOver(agent(""), kill, killed.Add(runnerOOMEpisode+time.Minute)), "the episode is over")

	// TEST_SCENARIO: the record of the attribution is what the agent carries, so a name and time read back are the kill that was attributed.
	attributed := &apiv1.Agent{}
	attributed.Annotations = map[string]string{annRunnerOOMKill: kill.ID}
	carried := carriedKill(attributed)
	assert.Equal(t, kill.ID, carried.ID)
	assert.Equal(t, killed.UTC(), carried.At.UTC())
	assert.True(t, carriedKill(&apiv1.Agent{}).IsZero(), "an agent that carries no kill")
}
