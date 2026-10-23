package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
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

// TEST_SCENARIO: the readiness publish puts a crash loop of the current pod on the Agent as StartFailed at the Agent's generation. A StatefulSet it cannot read leaves the condition as it is, since nothing was learned. It takes the condition off once the pod it reads is the old one of a roll, so a condition already written does not outlive the pod it was about.
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
	_, f = vmStartFailure(clock, 3, running, startNow.Add(119*time.Second))
	assert.Empty(t, f.reason, "within the bound")
	_, f = vmStartFailure(clock, 3, running, startNow.Add(2*time.Minute))
	assert.Equal(t, apiv1.ReasonNeverReady, f.reason, "reported before the five-minute vm idle timeout hibernates the agent")

	answered, _ := vmStartFailure(clock, 3, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true}, startNow.Add(time.Minute))
	_, f = vmStartFailure(answered, 3, running, startNow.Add(11*time.Minute))
	assert.Empty(t, f.reason, "an answer stops the clock")

	_, f = vmStartFailure(clock, 4, running, startNow.Add(time.Hour))
	assert.Empty(t, f.reason, "a new generation starts the clock again")
}

// TEST_SCENARIO: a first boot that copies a disk — a conversion or a migration seed's restore — runs for as long as the copy takes before the guest answers, and the runner bounds it at six hours. Past two minutes it is still no NeverReady, so the image update job does not move it back and stop the copy; once the runner stops reporting the copy, the clock starts from that read.
func TestVMStartFailureDoesNotCountABootCopyingADisk(t *testing.T) {
	copying := vmrunner.MachineStatus{State: vmrunner.StateRunning, Reason: vmrunner.ReasonCopyingDisk}
	clock, _ := vmStartFailure(vmStartClock{}, 3, copying, startNow)
	clock, f := vmStartFailure(clock, 3, copying, startNow.Add(time.Hour))
	assert.Empty(t, f.reason, "a copy an hour in is not a failed start")

	quiet := vmrunner.MachineStatus{State: vmrunner.StateRunning}
	clock, f = vmStartFailure(clock, 3, quiet, startNow.Add(time.Hour))
	assert.Empty(t, f.reason)
	_, f = vmStartFailure(clock, 3, quiet, startNow.Add(time.Hour+2*time.Minute))
	assert.Equal(t, apiv1.ReasonNeverReady, f.reason, "silence after the copy counts from when the copy ended")
}

// TEST_SCENARIO: a VMM the kernel or its seccomp filter killed is re-booted by the runner itself, and the runner reports the kill until the guest answers. That boot is the runner's own work, so it runs no not-ready bound of the controller's: an hour into it the Agent is not told its start failed, and the clock starts when the kill reason goes.
func TestVMStartFailureDoesNotCountAKillReboot(t *testing.T) {
	for _, reason := range []string{vmrunner.ReasonOOMKilled, vmrunner.ReasonSeccompKilled} {
		killed := vmrunner.MachineStatus{State: vmrunner.StateRunning, Reason: reason}
		clock, _ := vmStartFailure(vmStartClock{}, 3, killed, startNow)
		clock, f := vmStartFailure(clock, 3, killed, startNow.Add(time.Hour))
		assert.Empty(t, f.reason, "a re-boot an hour into a kill is not a failed start: %s", reason)

		quiet := vmrunner.MachineStatus{State: vmrunner.StateRunning}
		clock, f = vmStartFailure(clock, 3, quiet, startNow.Add(time.Hour))
		assert.Empty(t, f.reason, reason)
		_, f = vmStartFailure(clock, 3, quiet, startNow.Add(time.Hour+2*time.Minute))
		assert.Equal(t, apiv1.ReasonNeverReady, f.reason, "silence after the kill reason goes counts from there: %s", reason)
	}
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

func denied(message string) error {
	return &apierrors.StatusError{ErrStatus: metav1.Status{Status: metav1.StatusFailure, Code: 400, Message: message}}
}

func agentSSOn(image string) *appsv1.StatefulSet {
	ss := rolloutSS("my-agent", 1, 1, "r1")
	ss.Spec.Template.Spec.Containers = []corev1.Container{{Name: AgentContainerName, Image: image}}
	return ss
}

const stackroxDenial = `admission webhook "policyeval.stackrox.io" denied the request: The attempted operation violated 1 enforced policy: Policy: Block images older than 1 year`
