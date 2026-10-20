package reconciler

import (
	"context"
	stderrors "errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	k8stesting "k8s.io/client-go/testing"

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

// TEST_SCENARIO: the readiness publish puts a crash loop of the current pod on the Agent as StartFailed at the Agent's generation. A StatefulSet it cannot read leaves the condition as it is, since nothing was learned. It takes the condition off once the pod it reads is the old one of a roll, so a condition already written does not outlive the pod it was about.
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

	client.PrependReactor("get", "statefulsets", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, stderrors.New("apiserver unavailable")
	})
	require.NoError(t, r.publishReadiness(context.Background(), agent))
	assert.NotNil(t, startFailedCondition(t, r), "an unread StatefulSet removes nothing")
	client.ReactionChain = client.ReactionChain[1:]

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

// TEST_SCENARIO: the refusals of an agent StatefulSet write that fail the image it carries. A webhook's or a ValidatingAdmissionPolicy's refusal counts when the write moves the agent container to a new image, or creates the StatefulSet; a refusal of a StatefulSet already on that image, and an error that is no refusal, do not. A long finding list is capped well under the condition's size limit.
func TestAdmissionStartFailure(t *testing.T) {
	cases := []struct {
		name string
		err  error
		live *appsv1.StatefulSet
		want string
	}{
		{"webhook refuses the new image", denied(stackroxDenial), agentSSOn("old:1"), apiv1.ReasonAdmissionDenied},
		{"policy refuses the new image", denied(`statefulsets.apps "my-agent" is forbidden: ValidatingAdmissionPolicy 'p' with binding 'b' denied request: too old`), agentSSOn("old:1"), apiv1.ReasonAdmissionDenied},
		{"webhook refuses the first StatefulSet", denied(stackroxDenial), nil, apiv1.ReasonAdmissionDenied},
		{"the image already runs", denied(stackroxDenial), agentSSOn("new:2"), ""},
		{"a conflict is no refusal", apierrors.NewConflict(appsv1.Resource("statefulsets"), "my-agent", stderrors.New("modified")), agentSSOn("old:1"), ""},
		{"a plain error is no refusal", fmt.Errorf("applying: %w", stderrors.New("connection refused")), agentSSOn("old:1"), ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, admissionStartFailure(tc.err, tc.live, "new:2").reason)
		})
	}
	long := admissionStartFailure(denied(stackroxDenial+strings.Repeat(" CVE-2025-0001 found", 5000)), nil, "new:2")
	assert.LessOrEqual(t, len(long.message), admissionMessageMax+len("…"))
	assert.True(t, strings.HasPrefix(long.message, stackroxDenial))
}

// TEST_SCENARIO: a reconcile whose write of the agent StatefulSet with a new image is refused at admission puts StartFailed AdmissionDenied on the Agent at its generation, and still reports the reconcile error; the old StatefulSet stays. A refusal of the gateway StatefulSet is no start failure of the image.
func TestReconcileReportsAnAdmissionRefusalOfTheNewImage(t *testing.T) {
	ctx := context.Background()
	agent := agentCR()
	agent.Generation = 1
	r, client := setupReconciler(t, agent, readyPod("my-agent-0"), readyPod("my-agent-gateway-0"))
	require.NoError(t, r.Reconcile(ctx, agent))

	refuse := func(ssName string) {
		client.PrependReactor("update", "statefulsets", func(a k8stesting.Action) (bool, runtime.Object, error) {
			if a.(k8stesting.UpdateAction).GetObject().(*appsv1.StatefulSet).Name == ssName {
				return true, nil, denied(stackroxDenial)
			}
			return false, nil, nil
		})
	}

	agent.Generation = 2
	agent.Annotations = map[string]string{annRollRev: "v2"}
	refuse("my-agent-gateway")
	require.Error(t, r.Reconcile(ctx, agent))
	assert.Nil(t, startFailedCondition(t, r), "the gateway's refusal is not the agent image's")
	client.ReactionChain = client.ReactionChain[1:]
	require.NoError(t, r.Reconcile(ctx, agent))

	agent.Generation = 3
	agent.Spec.Image = "ghcr.io/myorg/agent:too-old"
	refuse("my-agent")
	require.Error(t, r.Reconcile(ctx, agent))
	cond := startFailedCondition(t, r)
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonAdmissionDenied, cond["reason"])
	assert.EqualValues(t, 3, cond["observedGeneration"])
	assert.Contains(t, cond["message"], "Block images older than 1 year")
	ss, err := client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, testAgent.Image, ss.Spec.Template.Spec.Containers[0].Image)
}
