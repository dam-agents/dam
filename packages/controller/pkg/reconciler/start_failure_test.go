package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// TEST_OVERVIEW: StartFailed tells the api-server that the pod or machine running the Agent's current spec keeps failing, so an image update can be rolled back on a crash loop or a harness that never becomes ready. It must never come from the old pod a roll replaces, which exits too.

var startNow = time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)

func agentContainer(pod *corev1.Pod, cs corev1.ContainerStatus) *corev1.Pod {
	cs.Name = AgentContainerName
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{cs}
	return pod
}

func crashing(restarts int32, exitCode int32, reason string) corev1.ContainerStatus {
	return corev1.ContainerStatus{
		RestartCount:         restarts,
		State:                corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}},
		LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{ExitCode: exitCode, Reason: reason}},
	}
}

func runningSince(ago time.Duration) corev1.ContainerStatus {
	return corev1.ContainerStatus{
		State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{StartedAt: metav1.NewTime(startNow.Add(-ago))}},
	}
}

// TEST_SCENARIO: each pod shape the agent StatefulSet can show during and after an image change. Only a pod of the update revision, unready now, with three own exits or ten unready minutes since its container started, is a failure. The old pod a roll replaces exits with 143 on SIGTERM and keeps its restart count: it must not count, nor may a pod read before the StatefulSet observed its new template.
func TestPodStartFailure(t *testing.T) {
	cases := []struct {
		name        string
		ss          bool
		observedGen int64
		pod         *corev1.Pod
		want        string
		recheck     time.Duration
	}{
		{"crash loop on the current revision", true, 1, agentContainer(podAtRev("a-0", "r2", false), crashing(3, 1, "Error")), apiv1.ReasonCrashLoop, 0},
		{"old pod exits during the roll", true, 1, agentContainer(podAtRev("a-0", "r1", false), crashing(5, 143, "Error")), "", 0},
		{"new template not observed yet", true, 0, agentContainer(podAtRev("a-0", "r2", false), crashing(3, 1, "Error")), "", 0},
		{"two restarts are not yet a loop", true, 1, agentContainer(podAtRev("a-0", "r2", false), crashing(2, 1, "Error")), "", 0},
		{"out of memory fails on any image", true, 1, agentContainer(podAtRev("a-0", "r2", false), crashing(3, 137, "OOMKilled")), "", 0},
		{"ready now after restarts", true, 1, agentContainer(podAtRev("a-0", "r2", true), crashing(3, 1, "Error")), "", 0},
		{"never ready past the bound", true, 1, agentContainer(podAtRev("a-0", "r2", false), runningSince(11*time.Minute)), apiv1.ReasonNeverReady, 0},
		{"not ready within the bound", true, 1, agentContainer(podAtRev("a-0", "r2", false), runningSince(4*time.Minute)), "", 6 * time.Minute},
		{"unready old pod past the bound", true, 1, agentContainer(podAtRev("a-0", "r1", false), runningSince(time.Hour)), "", 0},
		{"no statefulset", false, 1, agentContainer(podAtRev("a-0", "r2", false), crashing(3, 1, "Error")), "", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ss := rolloutSS("a", 1, tc.observedGen, "r2")
			if !tc.ss {
				ss = nil
			}
			failure, recheck := podStartFailure(ss, tc.pod, startNow)
			assert.Equal(t, tc.want, failure.reason)
			assert.Equal(t, tc.recheck, recheck)
		})
	}
}

func startFailedCondition(t *testing.T, r *AgentReconciler) map[string]any {
	t.Helper()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	for _, c := range conds {
		if m := c.(map[string]any); m["type"] == apiv1.ConditionStartFailed {
			return m
		}
	}
	return nil
}

// TEST_SCENARIO: the readiness publish puts a crash loop of the current pod on the Agent as StartFailed at the Agent's generation, and takes it off once the pod it reads is the old one of a roll, so a condition already written does not outlive the pod it was about.
func TestPublishReadinessReportsTheCurrentPodsStartFailure(t *testing.T) {
	agent := agentCR()
	agent.Generation = 4
	pod := agentContainer(podAtRev("my-agent-0", "r2", false), crashing(3, 1, "Error"))
	r, client := setupReconciler(t, agent, rolloutSS("my-agent", 1, 1, "r2"), pod, readyPod("my-agent-gateway-0"))

	require.NoError(t, r.publishReadiness(context.Background(), agent))
	cond := startFailedCondition(t, r)
	require.NotNil(t, cond)
	assert.Equal(t, "True", cond["status"])
	assert.Equal(t, apiv1.ReasonCrashLoop, cond["reason"])
	assert.EqualValues(t, 4, cond["observedGeneration"])

	pod.Labels["controller-revision-hash"] = "r1"
	_, err := client.CoreV1().Pods("test-agents").Update(context.Background(), pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.publishReadiness(context.Background(), agent))
	assert.Nil(t, startFailedCondition(t, r))
}

// TEST_SCENARIO: a vm machine on one generation, read over successive reconciles. The runner's restart count is cumulative, so restarts from an earlier spec do not count; the not-ready clock runs only while the machine is running and stops when it answers; a new generation starts both again.
func TestVMStartFailure(t *testing.T) {
	running := vmrunner.MachineStatus{State: vmrunner.StateRunning}
	clock, f := vmStartFailure(vmStartClock{}, 2, vmrunner.MachineStatus{State: vmrunner.StateRunning, Restarts: 5}, startNow)
	assert.Empty(t, f.reason, "restarts from before this generation do not count")
	assert.Equal(t, int32(5), clock.restartsAtGen)

	clock, f = vmStartFailure(clock, 2, vmrunner.MachineStatus{State: vmrunner.StateRunning, Restarts: 8}, startNow.Add(time.Minute))
	assert.Equal(t, apiv1.ReasonCrashLoop, f.reason)

	clock, f = vmStartFailure(vmStartClock{}, 3, vmrunner.MachineStatus{State: vmrunner.StateRestarting}, startNow)
	assert.Empty(t, f.reason)
	assert.True(t, clock.notReadySince.IsZero(), "a restart in flight, its pull included, is not counted")

	clock, _ = vmStartFailure(clock, 3, running, startNow)
	_, f = vmStartFailure(clock, 3, running, startNow.Add(9*time.Minute))
	assert.Empty(t, f.reason, "within the bound")
	_, f = vmStartFailure(clock, 3, running, startNow.Add(10*time.Minute))
	assert.Equal(t, apiv1.ReasonNeverReady, f.reason)

	answered, _ := vmStartFailure(clock, 3, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true}, startNow.Add(5*time.Minute))
	_, f = vmStartFailure(answered, 3, running, startNow.Add(11*time.Minute))
	assert.Empty(t, f.reason, "an answer stops the clock")

	_, f = vmStartFailure(clock, 4, running, startNow.Add(time.Hour))
	assert.Empty(t, f.reason, "a new generation starts the clock again")
}

// TEST_SCENARIO: the vm readiness publish keeps the machine's clock across reconciles of one generation, so a guest restarted three times since the generation was first seen is put on the Agent as StartFailed, and a status the runner did not answer leaves the clock and the condition as they were.
func TestPublishVMReadinessReportsACrashLoopOnThisGeneration(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	agent.Generation = 2
	r, _ := setupReconciler(t, agent, readyPod("my-agent-gateway-0"))

	require.NoError(t, r.publishVMReadiness(ctx, agent, vmrunner.MachineStatus{State: vmrunner.StateRunning, Restarts: 1}, true))
	assert.Nil(t, startFailedCondition(t, r))
	require.NoError(t, r.publishVMReadiness(ctx, agent, vmrunner.MachineStatus{}, false))
	require.NoError(t, r.publishVMReadiness(ctx, agent, vmrunner.MachineStatus{State: vmrunner.StateRunning, Restarts: 4}, true))
	cond := startFailedCondition(t, r)
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonCrashLoop, cond["reason"])
	assert.EqualValues(t, 2, cond["observedGeneration"])
}
