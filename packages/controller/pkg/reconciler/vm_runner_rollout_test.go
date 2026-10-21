// TEST_OVERVIEW: a runner's machines are its processes, so a change to the runner pod reboots every machine of that owner. The controller must create a new owner's runner at once, leave a runner alone while its rendered pod is unchanged, and roll a changed pod to at most the roll's width (`rollout.maxConcurrent`, or `rollout.maxConcurrentPercent` of the install's runners) at a time, each holding its place until its new pod is ready and the machines that were ready before are ready again — or until the settle timeout says it never will be.
package reconciler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/equality"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/rand"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func setupRolloutReconciler(t *testing.T, owners ...string) (*AgentReconciler, map[string]*fakeNode) {
	t.Helper()
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	r.rollViewTTL = 0
	r.busyProbe = func(context.Context, string) bool { return false }
	cs := r.client.(*fake.Clientset)
	cs.PrependReactor("update", "deployments", func(action k8stesting.Action) (bool, runtime.Object, error) {
		dep := action.(k8stesting.UpdateAction).GetObject().(*appsv1.Deployment)
		stored, err := cs.Tracker().Get(action.GetResource(), dep.Namespace, dep.Name)
		if err != nil {
			return false, nil, nil
		}
		prev := stored.(*appsv1.Deployment)
		dep.Generation = prev.Generation
		if !equality.Semantic.DeepEqual(prev.Spec, dep.Spec) {
			dep.Generation++
		}
		return false, nil, nil
	})
	nodes := map[string]*fakeNode{}
	servers := map[string]*httptest.Server{}
	r.runnerEndpoint = func(owner string) string {
		if _, ok := servers[owner]; !ok {
			nodes[owner], servers[owner] = newFakeNode(t)
		}
		return servers[owner].URL
	}
	for _, owner := range owners {
		createRolloutRunner(t, r, owner)
	}
	return r, nodes
}

func createRolloutRunner(t *testing.T, r *AgentReconciler, owner string) {
	t.Helper()
	ctx := context.Background()
	issueRunnerTLS(t, r, owner)
	_, _, err := r.ensureRunner(ctx, owner)
	require.NoError(t, err)
	sec, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, r.runnerName(owner), metav1.GetOptions{})
	require.NoError(t, err)
	sec.Data["token"] = []byte("node-token")
	_, err = r.client.CoreV1().Secrets("test-agents").Update(ctx, sec, metav1.UpdateOptions{})
	require.NoError(t, err)
	settleRunnerPod(t, r, owner)
}

func settleRunnerPod(t *testing.T, r *AgentReconciler, owner string) {
	t.Helper()
	ctx := context.Background()
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(owner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Status.ObservedGeneration = dep.Generation
	dep.Status.Replicas, dep.Status.UpdatedReplicas, dep.Status.ReadyReplicas = 1, 1, 1
	_, err = r.client.AppsV1().Deployments("test-agents").UpdateStatus(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
}

func runnerImageOf(t *testing.T, r *AgentReconciler, owner string) string {
	t.Helper()
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(owner), metav1.GetOptions{})
	require.NoError(t, err)
	return dep.Spec.Template.Spec.Containers[0].Image
}

func setRolledAt(t *testing.T, r *AgentReconciler, owner string, at time.Time) {
	t.Helper()
	ctx := context.Background()
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(owner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Annotations[annRunnerRolledAt] = at.UTC().Format(time.RFC3339)
	_, err = r.client.AppsV1().Deployments("test-agents").Update(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
}

const (
	runnerV1 = "quay.io/dam-agents/vm-runner:1"
	runnerV2 = "quay.io/dam-agents/vm-runner:2"
)

// UNIT_BOUNDARY_DESCRIPTION: a release that changes the runner pod's shape, not only its image, so the runner rolls rather than hands off.
func changeRunnerPod(r *AgentReconciler) {
	r.config.VM.Runner.Image = runnerV2
	r.config.VM.Runner.BootMiB += 512
}

// TEST_SCENARIO: a new runner image reaches an install with two owners. The first owner's runner rolls, and the second keeps its old pod — and every machine on it — until the first runner's new pod is ready and the machine that was ready before the roll answers again.
func TestAChangedRunnerPodRollsOneOwnerAtATime(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	nodes["owner-a"].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	changeRunnerPod(r)

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "only one runner is mid-roll at a time")

	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped})
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "the first runner's new pod is not ready yet")

	settleRunnerPod(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "the pod is ready but the machine it had is not back")

	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "the first runner's machines are asked about on its own owner's turn only")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"), "the first runner settled, so the next one rolls")

	a, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName("owner-a"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotContains(t, a.Annotations, annRunnerRolledAt, "a settled roll is cleared, so later passes do not ask its runner again")
}

// TEST_SCENARIO: a new owner's first vm agent arrives while another owner's runner is mid-roll. Nothing of theirs is running yet, so there is nothing to protect by waiting — their runner is created at once, already on the new pod.
func TestANewOwnersRunnerIsCreatedDuringARoll(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a")
	changeRunnerPod(r)
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))

	issueRunnerTLS(t, r, "owner-new")
	_, _, err := r.ensureRunner(ctx, "owner-new")
	require.NoError(t, err)
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-new"))
}

// TEST_SCENARIO: every vm agent reconciles its owner's runner whenever its machine changes, and the drift sweep brings it back every five minutes. While the rendered pod is unchanged the Deployment is not written at all, so nothing on it moves and no roll can start by accident.
func TestAnUnchangedRunnerIsNotWritten(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a")
	cs := r.client.(*fake.Clientset)
	cs.ClearActions()

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	for _, a := range cs.Actions() {
		assert.False(t, a.GetVerb() == "update" && a.GetResource().Resource == "deployments", "unexpected %s of %s", a.GetVerb(), a.GetResource().Resource)
	}
}

// TEST_SCENARIO: a new runner image arrives while one owner's agent is in the middle of a turn. That runner does not roll — and holds no place, so another owner's runner rolls meanwhile — until the agent reports idle; an owner whose agent stays busy past `rollout.idleWait` rolls anyway.
func TestARunnerRollWaitsForItsAgentsToBeIdle(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b", "owner-c")
	for _, owner := range []string{"owner-a", "owner-c"} {
		nodes[owner].specs["busy-"+owner] = vmrunner.MachineSpec{Running: true}
		nodes[owner].set("busy-"+owner, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	}
	busy := map[string]bool{"busy-owner-a": true, "busy-owner-c": true}
	r.busyProbe = func(_ context.Context, name string) bool { return busy[name] }
	changeRunnerPod(r)

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "its agent is busy")
	heldEvents := eventsOn(t, r, r.runnerName("owner-a"))
	require.Len(t, heldEvents, 1, "the wait is announced once, not on every pass")
	assert.Equal(t, reasonRollHeldForIdle, heldEvents[0].Reason)
	assert.Equal(t, corev1.EventTypeNormal, heldEvents[0].Type)
	assert.Contains(t, heldEvents[0].Message, "busy-owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"), "a waiting runner holds no place in the roll")
	settleRunnerPod(t, r, "owner-b")

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "its agent is still busy")
	busy["busy-owner-a"] = false
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"), "its agent is idle now")
	a, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName("owner-a"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotContains(t, a.Annotations, annRunnerBusy, "the roll clears the wait")
	settleRunnerPod(t, r, "owner-a")

	r.config.VM.Runner.Rollout.MaxConcurrent = 3
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-c", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-c"))
	c, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName("owner-c"), metav1.GetOptions{})
	require.NoError(t, err)
	c.Annotations[annRunnerBusy] = time.Now().Add(-defaultRunnerIdleWait - time.Minute).UTC().Format(time.RFC3339)
	_, err = r.client.AppsV1().Deployments("test-agents").Update(ctx, c, metav1.UpdateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-c", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-c"), "the idle wait is over")
	cEvents := eventsOn(t, r, r.runnerName("owner-c"))
	require.Len(t, cEvents, 2, "the wait and its end are each announced once")
	assert.Equal(t, reasonRollHeldForIdle, cEvents[0].Reason)
	assert.Equal(t, reasonRollIdleWaitOver, cEvents[1].Reason)
	assert.Equal(t, corev1.EventTypeWarning, cEvents[1].Type)
	assert.Contains(t, cEvents[1].Message, "stayed busy for 24h1m0s")
}

// TEST_SCENARIO: a runner that cannot reach the node's image cache boots only the trees its machines already hold, so every image its owner has not booted yet is refused. Waiting out a busy agent would cost the owner every image move for the whole idle wait to protect one turn, so once the refusal has lasted the grace such a runner rolls without the idle wait, and says so with one Event naming the node directory it mounts and the refusal it gave. The wait itself is untouched for every other runner: the second owner's cache answers, so its busy agent still holds it back.
func TestARunnerThatCannotReachItsImageCacheRollsWithoutWaitingForIdle(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	for _, owner := range []string{"owner-a", "owner-b"} {
		nodes[owner].specs["busy"+owner] = vmrunner.MachineSpec{Running: true}
		nodes[owner].set("busy"+owner, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	}
	r.busyProbe = func(_ context.Context, _ string) bool { return true }
	changeRunnerPod(r)
	r.config.VM.Runner.Rollout.MaxConcurrent = 2

	nodes["owner-a"].imageCache = vmrunner.RunnerImageCache{Socket: "/var/lib/platform/images/.cache.sock", Error: "the node's image cache service at /var/lib/platform/images/.cache.sock cannot be reached: Connection refused (os error 111)"}
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "one refused connect is also a cache service restarting")

	backdateRunnerAnnotation(t, r, "owner-a", annRunnerCacheDown, defaultRunnerCacheDownGrace+time.Minute)
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"), "a runner whose cache stayed out of reach does not wait for a turn to end")

	events := eventsOn(t, r, r.runnerName("owner-a"))
	require.Len(t, events, 2, "the hold and the roll that skips the wait are each announced once")
	assert.Equal(t, reasonRollHeldForCache, events[0].Reason)
	assert.Equal(t, corev1.EventTypeNormal, events[0].Type)
	assert.Equal(t, reasonRollImageCacheUnreachable, events[1].Reason)
	assert.Equal(t, corev1.EventTypeWarning, events[1].Type)
	assert.Contains(t, events[1].Message, r.config.VM.Runner.ImageCacheHostPath, "the Event does not name the node directory the runner mounts")
	assert.Contains(t, events[1].Message, "cannot be reached", "the Event does not carry the runner's own refusal")
	assert.Contains(t, events[1].Message, "without waiting", "the Event does not say the idle wait was skipped")

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "a runner whose cache answers still waits for its agent")
}

// TEST_SCENARIO: a cache service restarted, or a socket rebound under it, refuses one connect and answers the next. The owner's busy runner must keep the idle wait through that: one refused probe is not the fault the wait is skipped for, and a blip that comes back starts the grace over rather than counting toward it.
func TestASingleRefusedConnectDoesNotSkipTheIdleWait(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a")
	nodes["owner-a"].specs["busy"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("busy", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.busyProbe = func(context.Context, string) bool { return true }
	changeRunnerPod(r)

	nodes["owner-a"].imageCache = vmrunner.RunnerImageCache{Socket: "/var/lib/platform/images/.cache.sock", Error: "the node's image cache service at /var/lib/platform/images/.cache.sock cannot be reached: Connection refused (os error 111)"}
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "a refused connect alone does not roll a busy runner")
	dep := runnerDeploymentOf(t, r, "owner-a")
	assert.NotEmpty(t, dep.Annotations[annRunnerCacheDown], "the pass that saw the refusal did not record when")

	nodes["owner-a"].imageCache = vmrunner.RunnerImageCache{Socket: "/var/lib/platform/images/.cache.sock"}
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "its agent is busy")
	assert.Empty(t, runnerDeploymentOf(t, r, "owner-a").Annotations[annRunnerCacheDown], "a cache that answers clears the stamp")

	nodes["owner-a"].imageCache = vmrunner.RunnerImageCache{Socket: "/var/lib/platform/images/.cache.sock", Error: "the node's image cache service at /var/lib/platform/images/.cache.sock cannot be reached: Connection refused (os error 111)"}
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "the grace started over with the second outage")

	events := eventsOn(t, r, r.runnerName("owner-a"))
	require.Len(t, events, 3, "the two outages and the turn the middle pass found are each announced once")
	assert.Equal(t, reasonRollHeldForCache, events[0].Reason)
	assert.Equal(t, reasonRollHeldForIdle, events[1].Reason, "the cache answered, so the wait for the agent is what holds it")
	assert.Equal(t, reasonRollHeldForCache, events[2].Reason)
	for _, event := range events {
		assert.NotEqual(t, reasonRollImageCacheUnreachable, event.Reason, "no pass skipped the idle wait")
	}
}

// UNIT_BOUNDARY_DESCRIPTION: a fake API server that numbers every write and refuses one carrying an older number, which is what the real one does and what the default fake client does not: a pass that writes an annotation and then submits the roll from the object it read before that write is refused, and the retry reads the version its own write left.
func enforceResourceVersions(t *testing.T, r *AgentReconciler) {
	t.Helper()
	cs := r.client.(*fake.Clientset)
	version := 1000
	cs.PrependReactor("update", "deployments", func(action k8stesting.Action) (bool, runtime.Object, error) {
		dep := action.(k8stesting.UpdateAction).GetObject().(*appsv1.Deployment)
		stored, err := cs.Tracker().Get(action.GetResource(), dep.Namespace, dep.Name)
		if err != nil {
			return false, nil, nil
		}
		if current := stored.(*appsv1.Deployment).ResourceVersion; dep.ResourceVersion != current {
			return true, nil, k8serrors.NewConflict(appsv1.Resource("deployments"), dep.Name, errors.New("the object has been modified"))
		}
		version++
		dep.ResourceVersion = strconv.Itoa(version)
		return false, nil, nil
	})
}

// TEST_SCENARIO: the grace has expired and the cache is still out of reach, so this pass rolls the busy runner. Every stamp it would clear first is cleared by the roll's own write; a pass that wrote one first would submit the roll from the version it read before that write, the API server would refuse it, and the retry — reading a runner with no stamp — would record a fresh outage and hold again, so the runner would never roll while the cache stayed down.
func TestAnExpiredGraceRollsTheRunnerInOnePass(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a")
	nodes["owner-a"].specs["busy"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("busy", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.busyProbe = func(context.Context, string) bool { return true }
	changeRunnerPod(r)
	nodes["owner-a"].imageCache = vmrunner.RunnerImageCache{Socket: "/var/lib/platform/images/.cache.sock", Error: "the node's image cache service at /var/lib/platform/images/.cache.sock cannot be reached: Connection refused (os error 111)"}
	backdateRunnerAnnotation(t, r, "owner-a", annRunnerCacheDown, defaultRunnerCacheDownGrace+time.Minute)
	enforceResourceVersions(t, r)

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true), "the pass wrote before the roll and lost the roll's write to a conflict")
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"), "an expired grace must roll the runner, not start it over")
	assert.Empty(t, runnerAnnotations(t, r, "owner-a")[annRunnerCacheDown], "the roll's own write clears the stamp")
}

// TEST_SCENARIO: a pod change undone before the roll leaves a stamp from the pass that recorded the outage. The stamp is what the grace is measured from, so one left behind makes the next refusal pass the minute at once and roll a runner with busy agents; the pass that finds nothing to roll clears it.
func TestARollThatStopsBeingNeededClearsTheCacheStamp(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a")
	nodes["owner-a"].specs["busy"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("busy", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.busyProbe = func(context.Context, string) bool { return true }
	boot := r.config.VM.Runner.BootMiB
	changeRunnerPod(r)

	nodes["owner-a"].imageCache = vmrunner.RunnerImageCache{Socket: "/var/lib/platform/images/.cache.sock", Error: "the node's image cache service at /var/lib/platform/images/.cache.sock cannot be reached: Connection refused (os error 111)"}
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NotEmpty(t, runnerAnnotations(t, r, "owner-a")[annRunnerCacheDown], "the refusal was not recorded")

	r.config.VM.Runner.Image, r.config.VM.Runner.BootMiB = runnerV1, boot
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Empty(t, runnerAnnotations(t, r, "owner-a")[annRunnerCacheDown], "a roll nobody needs any more keeps a stamp from the outage it was waiting out")
}

// TEST_SCENARIO: a cache that recovers while every place in the roll is taken is never seen to recover, so the minute counts only over what a pass watched. A stamp from before that recovery would let the next outage pass it at once and end the turns of busy agents.
func TestAnOutageNoPassCouldWatchDoesNotCountTowardTheGrace(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	nodes["owner-a"].specs["busy"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("busy", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.busyProbe = func(_ context.Context, id string) bool { return id == "busy" }
	r.config.VM.Runner.Rollout.MaxConcurrent = 1
	changeRunnerPod(r)

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"), "the only place in the roll is taken")

	nodes["owner-a"].imageCache = vmrunner.RunnerImageCache{Socket: "/var/lib/platform/images/.cache.sock", Error: "the node's image cache service at /var/lib/platform/images/.cache.sock cannot be reached: Connection refused (os error 111)"}
	backdateRunnerAnnotation(t, r, "owner-a", annRunnerCacheDown, defaultRunnerCacheDownGrace+time.Minute)
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "the pass had no place to roll in")
	assert.Empty(t, runnerAnnotations(t, r, "owner-a")[annRunnerCacheDown], "a stamp from an outage no pass watched outlived the place it waited for")

	settleRunnerPod(t, r, "owner-b")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "the minute starts over with the outage the pass can watch")
	for _, event := range eventsOn(t, r, r.runnerName("owner-a")) {
		assert.NotEqual(t, reasonRollImageCacheUnreachable, event.Reason, "no pass skipped the idle wait on an outage it did not watch")
	}
}

// TEST_SCENARIO: a runner that cannot be asked about its image cache is not a runner whose cache is out of reach: it may have a working one, so its busy agents keep the idle wait, and no pass spends the grace on a read that failed.
func TestARunnerThatCannotBeAskedKeepsTheIdleWait(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a")
	nodes["owner-a"].specs["busy"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("busy", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.busyProbe = func(context.Context, string) bool { return true }
	changeRunnerPod(r)
	nodes["owner-a"].imageCacheFails = true

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "an unanswered runner waits for its agent")
	dep := runnerDeploymentOf(t, r, "owner-a")
	assert.Empty(t, dep.Annotations[annRunnerCacheDown], "a read that failed is not an outage to measure")
	events := eventsOn(t, r, r.runnerName("owner-a"))
	require.Len(t, events, 1, "the wait is what holds it, and it says so once")
	assert.Equal(t, reasonRollHeldForIdle, events[0].Reason)
}

// TEST_SCENARIO: a roll that says it passes the idle wait says so once it wrote the Deployment. A write that fails leaves the roll for the next pass, and the next pass is the one that announces it.
func TestTheWaitOverEventFollowsTheRoll(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a")
	nodes["owner-a"].specs["busy"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("busy", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.busyProbe = func(context.Context, string) bool { return true }
	changeRunnerPod(r)
	backdateRunnerAnnotation(t, r, "owner-a", annRunnerBusy, defaultRunnerIdleWait+time.Minute)

	cs := r.client.(*fake.Clientset)
	refused := true
	cs.PrependReactor("update", "deployments", func(action k8stesting.Action) (bool, runtime.Object, error) {
		dep := action.(k8stesting.UpdateAction).GetObject().(*appsv1.Deployment)
		if !refused || dep.Annotations[annRunnerRolledAt] == "" {
			return false, nil, nil
		}
		return true, nil, k8serrors.NewConflict(appsv1.Resource("deployments"), dep.Name, errors.New("the informer's copy is older"))
	})

	assert.Error(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true), "the roll's write was refused")
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "the roll did not land")
	assert.Empty(t, eventsOn(t, r, r.runnerName("owner-a")), "a roll that did not happen is not announced")

	refused = false
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"))
	events := eventsOn(t, r, r.runnerName("owner-a"))
	require.Len(t, events, 1, "the pass that rolled says it once")
	assert.Equal(t, reasonRollIdleWaitOver, events[0].Reason)
}

// TEST_SCENARIO: the pass that would hold a roll writes the stamp the next pass reads. When that write fails — an informer copy from before the write, which the API server refuses as a conflict — the pass reports nothing: a hold said twice for one wait is the noise the Events exist to remove, and the next pass says it when it lands.
func TestARollWhoseWaitCannotBeRecordedSaysNothing(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a")
	nodes["owner-a"].specs["busy"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("busy", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.busyProbe = func(context.Context, string) bool { return true }
	changeRunnerPod(r)

	cs := r.client.(*fake.Clientset)
	conflicts := true
	cs.PrependReactor("update", "deployments", func(k8stesting.Action) (bool, runtime.Object, error) {
		if !conflicts {
			return false, nil, nil
		}
		return true, nil, k8serrors.NewConflict(appsv1.Resource("deployments"), r.runnerName("owner-a"), errors.New("the informer's copy is older"))
	})

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"))
	assert.Empty(t, eventsOn(t, r, r.runnerName("owner-a")), "a wait that was not recorded is not announced")

	conflicts = false
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	events := eventsOn(t, r, r.runnerName("owner-a"))
	require.Len(t, events, 1, "the transition is announced on the pass that records it")
	assert.Equal(t, reasonRollHeldForIdle, events[0].Reason)
}

// UNIT_BOUNDARY_DESCRIPTION: the runner Deployment of one owner, read back from the API server rather than from the reconciler's copy.
func runnerDeploymentOf(t *testing.T, r *AgentReconciler, owner string) *appsv1.Deployment {
	t.Helper()
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(owner), metav1.GetOptions{})
	require.NoError(t, err)
	return dep
}

// UNIT_BOUNDARY_DESCRIPTION: an annotation moved back in time on the runner Deployment, which is how a test reaches a wait that has lasted: the pass reads the stamp, so a hold older than its grace is one written before it.
func backdateRunnerAnnotation(t *testing.T, r *AgentReconciler, owner, key string, age time.Duration) {
	t.Helper()
	dep := runnerDeploymentOf(t, r, owner)
	if dep.Annotations == nil {
		dep.Annotations = map[string]string{}
	}
	dep.Annotations[key] = time.Now().Add(-age).UTC().Format(time.RFC3339)
	_, err := r.client.AppsV1().Deployments("test-agents").Update(context.Background(), dep, metav1.UpdateOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: a roll held back for a busy agent is one Event when the wait starts and one when it passes the idle wait, never the same line on every pass, and the Deployment records the wait so a controller restart does not start it over. The second pass of a held roll writes no second Event.
func TestARollHeldForIdleSaysSoOnce(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a")
	nodes["owner-a"].specs["busy"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("busy", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.busyProbe = func(context.Context, string) bool { return true }
	changeRunnerPod(r)

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"))
	events := eventsOn(t, r, r.runnerName("owner-a"))
	require.Len(t, events, 1, "a held roll is reported once, not on every pass")
	assert.Equal(t, reasonRollHeldForIdle, events[0].Reason)
	assert.Contains(t, events[0].Message, "busy")
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName("owner-a"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEmpty(t, dep.Annotations[annRunnerBusy])
}

// UNIT_BOUNDARY_DESCRIPTION: the Events written on one runner, in name order, which is the order they were written: the name is the runner's and a nanosecond, so a test reads them back as a person reads `kubectl get events`. The fake client applies no field selector, so the object is matched here instead.
func eventsOn(t *testing.T, r *AgentReconciler, name string) []corev1.Event {
	t.Helper()
	list, err := r.client.CoreV1().Events("test-agents").List(context.Background(), metav1.ListOptions{})
	require.NoError(t, err)
	var events []corev1.Event
	for _, event := range list.Items {
		if event.InvolvedObject.Name == name {
			events = append(events, event)
		}
	}
	sort.Slice(events, func(i, j int) bool { return events[i].Name < events[j].Name })
	return events
}

// TEST_SCENARIO: a machine that was ready before the roll never comes back — its agent was hibernated mid-roll, say. The runner stops holding its place once the settle timeout has passed, so one owner cannot stall every other owner's upgrade.
func TestARollThatNeverSettlesStopsHoldingItsPlace(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	nodes["owner-a"].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	changeRunnerPod(r)
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, "owner-a")
	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped})

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"))

	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"))
}

// TEST_SCENARIO: a machine that was ready before the roll belongs to an agent deleted during it. It will never be ready again, and there is nothing left to wait for.
func TestAMachineWhoseAgentIsGoneDoesNotHoldTheRoll(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	nodes["owner-a"].specs["deleted-agent"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("deleted-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	changeRunnerPod(r)
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, "owner-a")
	nodes["owner-a"].set("deleted-agent", vmrunner.MachineStatus{State: vmrunner.StateAbsent})

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"))
}

// TEST_SCENARIO: an install with many owners raises the roll's width. That many runners roll together, and the next one still waits.
func TestTheRollWidthIsTheInstalls(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-b", "owner-c")
	r.config.VM.Runner.Rollout.MaxConcurrent = 2
	changeRunnerPod(r)

	for _, owner := range []string{"owner-a", "owner-b", "owner-c"} {
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	}
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-c"))
}

// TEST_SCENARIO: an owner whose agents are all hibernated has nothing reconciling their runner. The periodic sweep offers every runner its turn in name order, so the roll still reaches them — one at a time.
func TestTheSweepRollsRunnersNoAgentReconciles(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-b")
	settleRunnerPod(t, r, testOwner)
	owners := []string{testOwner, "owner-a", "owner-b"}
	sort.Slice(owners, func(i, j int) bool { return r.runnerName(owners[i]) < r.runnerName(owners[j]) })
	changeRunnerPod(r)

	for pass := range owners {
		r.ReconcileRunnerRollout(ctx)
		for i, owner := range owners {
			dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(owner), metav1.GetOptions{})
			require.NoError(t, err)
			rolled := len(dep.Spec.Template.Spec.Containers) > 0 && dep.Spec.Template.Spec.Containers[0].Image == runnerV2
			assert.Equal(t, i <= pass, rolled, "pass %d, runner %d in name order", pass, i)
		}
		settleRunnerPod(t, r, owners[pass])
	}
}

// TEST_SCENARIO: a runner release whose pod never becomes ready — a bad image, a missing device. Past the settle timeout the roll keeps its place rather than moving on to break the next owner too, and the runner is marked stalled. Once its pod is ready the mark is cleared and the roll moves on.
func TestARollWhosePodNeverStartsHaltsTheRoll(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-b")
	changeRunnerPod(r)
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "the next owner does not roll onto a pod that does not start")
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName("owner-a"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEmpty(t, dep.Annotations[annRunnerStalled])

	settleRunnerPod(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"))
	dep, err = r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName("owner-a"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Empty(t, dep.Annotations[annRunnerStalled])
}

// TEST_SCENARIO: the rolled pod of one owner is stuck in a state no release can cause — its claim is refused as Multi-Attach while its containers are still being created, or its node is gone or not ready and the old pod never finishes terminating. Past the settle timeout the runner gives up its place and the next owner rolls. A pod the scheduler cannot place, one still creating without a Multi-Attach refusal, an old pod terminating on a ready node, a container that started and is not ready, and an image that does not pull keep the roll halted, since a release can cause each of them.
func TestARollStuckOnTheOwnersOwnPodIsSkipped(t *testing.T) {
	scheduled := corev1.PodCondition{Type: corev1.PodScheduled, Status: corev1.ConditionTrue}
	waiting := func(reason string) []corev1.ContainerStatus {
		return []corev1.ContainerStatus{{Name: "runner", State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: reason}}}}
	}
	creating := corev1.Pod{Spec: corev1.PodSpec{NodeName: "node-a"}, Status: corev1.PodStatus{Phase: corev1.PodPending, Conditions: []corev1.PodCondition{scheduled}, ContainerStatuses: waiting("ContainerCreating")}}
	terminating := corev1.Pod{ObjectMeta: metav1.ObjectMeta{DeletionTimestamp: &metav1.Time{Time: time.Now()}, Finalizers: []string{"test"}}, Spec: corev1.PodSpec{NodeName: "node-a"}, Status: corev1.PodStatus{Phase: corev1.PodRunning}}
	nodeReady := func(status corev1.ConditionStatus) *corev1.Node {
		return &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-a"}, Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: status}}}}
	}
	for name, tc := range map[string]struct {
		pod         corev1.Pod
		node        *corev1.Node
		multiAttach bool
		skipped     bool
	}{
		"multi-attach":                    {pod: creating, multiAttach: true, skipped: true},
		"terminating on a deleted node":   {pod: terminating, skipped: true},
		"terminating on a node not ready": {pod: terminating, node: nodeReady(corev1.ConditionUnknown), skipped: true},
		"terminating on a ready node":     {pod: terminating, node: nodeReady(corev1.ConditionTrue)},
		"creating without a multi-attach": {pod: creating},
		"unschedulable":                   {pod: corev1.Pod{Status: corev1.PodStatus{Phase: corev1.PodPending, Conditions: []corev1.PodCondition{{Type: corev1.PodScheduled, Status: corev1.ConditionFalse, Reason: corev1.PodReasonUnschedulable}}}}},
		"image pull":                      {pod: corev1.Pod{Spec: corev1.PodSpec{NodeName: "node-a"}, Status: corev1.PodStatus{Phase: corev1.PodPending, Conditions: []corev1.PodCondition{scheduled}, ContainerStatuses: waiting("ImagePullBackOff")}}, multiAttach: true},
		"crash loop":                      {pod: corev1.Pod{Status: corev1.PodStatus{Phase: corev1.PodRunning, Conditions: []corev1.PodCondition{scheduled}, ContainerStatuses: []corev1.ContainerStatus{{Name: "runner", RestartCount: 3, State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}}}}}}},
		"never ready":                     {pod: corev1.Pod{Status: corev1.PodStatus{Phase: corev1.PodRunning, Conditions: []corev1.PodCondition{scheduled}, ContainerStatuses: []corev1.ContainerStatus{{Name: "runner", State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}}}}}},
	} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			r, _ := setupRolloutReconciler(t, "owner-a", "owner-b")
			changeRunnerPod(r)
			require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
			setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))
			pod := tc.pod
			pod.Name, pod.Namespace, pod.UID, pod.Labels = r.runnerName("owner-a")+"-x", "test-agents", "pod-uid", vmRunnerSelector("owner-a")
			_, err := r.client.CoreV1().Pods("test-agents").Create(ctx, &pod, metav1.CreateOptions{})
			require.NoError(t, err)
			if tc.node != nil {
				_, err = r.client.CoreV1().Nodes().Create(ctx, tc.node, metav1.CreateOptions{})
				require.NoError(t, err)
			}
			if tc.multiAttach {
				_, err = r.client.CoreV1().Events("test-agents").Create(ctx, &corev1.Event{
					ObjectMeta:     metav1.ObjectMeta{Name: pod.Name + ".attach", Namespace: "test-agents"},
					InvolvedObject: corev1.ObjectReference{Kind: "Pod", Name: pod.Name, UID: pod.UID},
					Type:           corev1.EventTypeWarning,
					Reason:         "FailedAttachVolume",
					Message:        `Multi-Attach error for volume "pvc-1" Volume is already exclusively attached to one node and can't be attached to another`,
				}, metav1.CreateOptions{})
				require.NoError(t, err)
			}

			require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
			want := runnerV1
			if tc.skipped {
				want = runnerV2
			}
			assert.Equal(t, want, runnerImageOf(t, r, "owner-b"))
		})
	}
}

// TEST_SCENARIO: the rollout sweep offers every runner its turn, and each turn asks which runners are mid-roll. That answer is kept for a few seconds, so a pass over many owners lists the runner Deployments a bounded number of times rather than once per owner.
func TestTheRolloutSweepListsRunnersOncePerPass(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-b", "owner-c", "owner-d")
	r.rollViewTTL = runnerRollViewTTL
	changeRunnerPod(r)
	cs := r.client.(*fake.Clientset)
	cs.ClearActions()

	r.ReconcileRunnerRollout(ctx)

	lists := 0
	for _, a := range cs.Actions() {
		if a.GetVerb() == "list" && a.GetResource().Resource == "deployments" {
			lists++
		}
	}
	assert.Equal(t, 3, lists, "one List for the owner gateways, one for the sweep's own order, one for the runners mid-roll")
}

// TEST_SCENARIO: every runner is rolled when this hash changes, which reboots every vm machine of the install. A change to how the controller renders the runner pod must therefore be deliberate: this pins the hash for a fixed configuration, so an unintended rendering change fails here rather than in a fleet-wide reboot.
func TestTheRunnerTemplateHashIsPinned(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.Reconcile(ctx, agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "58aebcc11cdfde48", dep.Annotations[annRunnerTemplate])
}

// TEST_SCENARIO: the chart gives every runner pod a PriorityClass, and a roll hash that covered it would reboot every machine of every owner on the install that first set one. The class is left out of what the roll compares, so an existing runner keeps its pod and takes the class at its next replacement, while a change to the pod itself still rolls.
func TestThePriorityClassDoesNotRollTheFleet(t *testing.T) {
	spec := func(class string) appsv1.DeploymentSpec {
		return appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
			PriorityClassName: class,
			Containers:        []corev1.Container{{Name: vmRunnerComponent, Image: "runner:1"}},
		}}}
	}
	bare, err := runnerTemplateHash(runnerRollSpec(spec("")))
	require.NoError(t, err)
	classed, err := runnerTemplateHash(runnerRollSpec(spec("platform-vm-runner-priority")))
	require.NoError(t, err)
	assert.Equal(t, bare, classed, "adding the class rolled the fleet")

	other, err := runnerTemplateHash(runnerRollSpec(spec("another-class")))
	require.NoError(t, err)
	assert.Equal(t, bare, other, "a different class rolled the fleet too")

	changed := spec("platform-vm-runner-priority")
	changed.Template.Spec.Containers[0].Args = []string{"--boot-mib=1024"}
	real, err := runnerTemplateHash(runnerRollSpec(changed))
	require.NoError(t, err)
	assert.NotEqual(t, classed, real, "a real pod change still rolls")
}

// TEST_SCENARIO: a runner's pod is unchanged, but its labels were edited by hand and its owner reference points at nothing — the runner ServiceAccount was recreated. Both are restored without touching the pod, so no machine restarts and no roll starts. The claim, written by an older controller with the account as its owner, loses that reference, so a later deletion of the account cannot collect the owner's disks.
func TestAnUnchangedRunnerGetsItsLabelsAndOwnerBack(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	_, err := r.client.CoreV1().ServiceAccounts("test-agents").Create(ctx, &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner", Namespace: "test-agents", UID: "sa-now"},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, agent))
	deps := r.client.AppsV1().Deployments("test-agents")
	dep, err := deps.Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	delete(dep.Annotations, annRunnerRolledAt)
	delete(dep.Labels, "app.kubernetes.io/instance")
	dep.OwnerReferences = []metav1.OwnerReference{{APIVersion: "v1", Kind: "ServiceAccount", Name: "platform-vm-runner", UID: "sa-before"}}
	_, err = deps.Update(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
	pvcs := r.client.CoreV1().PersistentVolumeClaims("test-agents")
	pvc, err := pvcs.Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	pvc.OwnerReferences = []metav1.OwnerReference{{APIVersion: "v1", Kind: "ServiceAccount", Name: "platform-vm-runner", UID: "sa-now"}}
	_, err = pvcs.Update(ctx, pvc, metav1.UpdateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))

	dep, err = deps.Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "platform", dep.Labels["app.kubernetes.io/instance"])
	require.Len(t, dep.OwnerReferences, 1)
	assert.Equal(t, types.UID("sa-now"), dep.OwnerReferences[0].UID)
	assert.Empty(t, dep.Annotations[annRunnerRolledAt], "restoring metadata does not start a roll")
	pvc, err = pvcs.Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Empty(t, pvc.OwnerReferences, "the account's reference on an existing claim is stripped")
}

// TEST_SCENARIO: a new runner image is not a changed pod. Every owner's pod keeps its image and every machine on it, and each owner's runner is named the new image over its machine API, which the pod's loader takes in place — one owner at a time, as a pod roll goes: the second owner is named the release only once the first runner reports it running and its machine that was ready is ready again. The release named is recorded on the runner's Deployment, which the controller owns.
func TestANewRunnerImageReachesEveryOwnerWithoutAPodRoll(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	for _, owner := range []string{"owner-a", "owner-b"} {
		createRolloutRunner(t, r, owner)
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	}
	nodes["owner-a"].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.config.VM.Runner.Image = runnerV2

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, namedRelease(t, r, "owner-a"))
	assert.Equal(t, []string{runnerV2}, nodes["owner-a"].named, "the release is named over the machine API at once")
	assert.Equal(t, runnerV1, namedRelease(t, r, "owner-b"), "only one runner hands off at a time")
	assert.Empty(t, nodes["owner-b"].named)

	nodes["owner-a"].release = vmrunner.RunnerRelease{Running: runnerV2, Target: runnerV2}
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, namedRelease(t, r, "owner-b"), "the first runner runs the release, but its agent has not had an ensure against it yet")

	backdateHandoff(t, r, "owner-a", runnerHandoffObserve+time.Second)
	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateCreating})
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, namedRelease(t, r, "owner-b"), "the first runner runs the release but its machine is not back")

	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, namedRelease(t, r, "owner-b"), "the first runner's hand-off is settled on its own owner's turn only")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	for _, owner := range []string{"owner-a", "owner-b"} {
		assert.Equal(t, runnerV1, runnerImageOf(t, r, owner), "the pod keeps the image it started with")
		assert.Equal(t, runnerV2, namedRelease(t, r, owner))
	}
}

// TEST_SCENARIO: a runner pod that restarted, after the controller named it a release, runs its own image again and has forgotten the name. The controller still records the release on the Deployment, so on the owner's next turn it names it again, and a restarted controller does the same from that record.
func TestARunnerThatForgotItsReleaseIsNamedItAgain(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	createRolloutRunner(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.Equal(t, []string{runnerV2}, nodes["owner-a"].named)

	nodes["owner-a"].release = vmrunner.RunnerRelease{Running: runnerV1}
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, []string{runnerV2, runnerV2}, nodes["owner-a"].named)
}

// TEST_SCENARIO: a runner release that runs but refuses every ensure must not reach every owner. The first owner's runner reports the release running and its machine still ready, an agent's ensure is refused, and the hand-off stalls: the second owner is not named the release while the stall stands. An operator removing the stall annotation from the runner's Deployment lets the release go on.
func TestARunnerReleaseThatRefusesEnsuresGoesNoFurther(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	for _, owner := range []string{testOwner, "owner-b"} {
		createRolloutRunner(t, r, owner)
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	}
	nodes[testOwner].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	require.Equal(t, runnerV2, namedRelease(t, r, testOwner))

	nodes[testOwner].release = vmrunner.RunnerRelease{Running: runnerV2, Target: runnerV2}
	nodes[testOwner].refusesEnsures = true
	agent := vmAgentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	assert.Error(t, r.Reconcile(ctx, agent))

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, namedRelease(t, r, "owner-b"), "a stalled hand-off halts the release")

	deps := r.client.AppsV1().Deployments("test-agents")
	dep, err := deps.Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	require.Contains(t, dep.Annotations, annRunnerHandoffStalled)
	delete(dep.Annotations, annRunnerHandoffStalled)
	_, err = deps.Update(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, namedRelease(t, r, "owner-b"), "clearing the stall resumes the release")
}

// TEST_SCENARIO: a runner that holds the new release as failed, or that does not settle on it within the settle timeout, stalls the release just as a refused ensure does. A newer configured release resumes it, starting with the runner that stalled.
func TestARunnerHandOffInTroubleHaltsTheRelease(t *testing.T) {
	for name, trouble := range map[string]func(*testing.T, *AgentReconciler, *fakeNode){
		"held failed": func(_ *testing.T, _ *AgentReconciler, n *fakeNode) {
			n.release = vmrunner.RunnerRelease{Running: runnerV1, Target: runnerV2, Held: vmrunner.HeldFailed}
		},
		"never settles": func(t *testing.T, r *AgentReconciler, n *fakeNode) {
			n.release = vmrunner.RunnerRelease{Running: runnerV1, Target: runnerV2}
			backdateHandoff(t, r, "owner-a", defaultRunnerSettleTimeout+time.Minute)
		},
	} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			r, nodes := setupRolloutReconciler(t)
			for _, owner := range []string{"owner-a", "owner-b"} {
				createRolloutRunner(t, r, owner)
				require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
			}
			r.config.VM.Runner.Image = runnerV2
			require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
			trouble(t, r, nodes["owner-a"])

			require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
			assert.Contains(t, runnerAnnotations(t, r, "owner-a"), annRunnerHandoffStalled)
			require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
			assert.Equal(t, runnerV1, namedRelease(t, r, "owner-b"), "a stalled hand-off halts the release")

			const runnerV3 = "quay.io/dam-agents/vm-runner:3"
			r.config.VM.Runner.Image = runnerV3
			require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
			assert.Equal(t, runnerV3, namedRelease(t, r, "owner-a"), "a newer release resumes the roll at the runner that stalled")
		})
	}
}

// TEST_SCENARIO: a chart upgrade names the release before every node's stager has staged it. A runner that reports the release not staged past the settle timeout is waiting on its node, not failing, so its hand-off is not stalled: its start moves up, it keeps its place, so the next owner still waits, and it settles once the runner takes the release.
func TestAHandOffWaitingForItsReleaseToBeStagedDoesNotStall(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	for _, owner := range []string{"owner-a", "owner-b"} {
		createRolloutRunner(t, r, owner)
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	}
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	nodes["owner-a"].release = vmrunner.RunnerRelease{Running: runnerV1, Target: runnerV2, Held: vmrunner.HeldUnstaged}
	backdateHandoff(t, r, "owner-a", defaultRunnerSettleTimeout+time.Minute)

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	ann := runnerAnnotations(t, r, "owner-a")
	assert.NotContains(t, ann, annRunnerHandoffStalled)
	at, err := time.Parse(time.RFC3339, ann[annRunnerHandoffAt])
	require.NoError(t, err)
	assert.WithinDuration(t, time.Now(), at, 5*time.Second, "the settle timeout counts from the last time the release was found not staged")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, namedRelease(t, r, "owner-b"), "the waiting hand-off keeps its place")

	nodes["owner-a"].release = vmrunner.RunnerRelease{Running: runnerV2, Target: runnerV2}
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, namedRelease(t, r, "owner-b"))
}

func runnerAnnotations(t *testing.T, r *AgentReconciler, owner string) map[string]string {
	t.Helper()
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(owner), metav1.GetOptions{})
	require.NoError(t, err)
	return dep.Annotations
}

func setRunnerAnnotation(t *testing.T, r *AgentReconciler, owner, key, value string) {
	t.Helper()
	deps := r.client.AppsV1().Deployments("test-agents")
	dep, err := deps.Get(context.Background(), r.runnerName(owner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Annotations[key] = value
	_, err = deps.Update(context.Background(), dep, metav1.UpdateOptions{})
	require.NoError(t, err)
}

func backdateHandoff(t *testing.T, r *AgentReconciler, owner string, by time.Duration) {
	t.Helper()
	setRunnerAnnotation(t, r, owner, annRunnerHandoffAt, time.Now().Add(-by).UTC().Format(time.RFC3339))
}

func namedRelease(t *testing.T, r *AgentReconciler, owner string) string {
	t.Helper()
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(owner), metav1.GetOptions{})
	require.NoError(t, err)
	return runnerReleaseOf(dep)
}

// TEST_SCENARIO: a runner release whose runner does not load in the pod cannot adopt the machines, so the pod's loader holds on to the release it runs. The controller reads that hold from the runner and rolls the pod onto the new image, through the same roll as any changed pod. A release that is only not staged yet is waited for, and one that failed to take over is not rolled onto.
func TestARunnerReleaseTheLoaderCannotTakeRollsThePod(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	createRolloutRunner(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, "owner-a")
	r.config.VM.Runner.Image = runnerV2

	nodes["owner-a"].release = vmrunner.RunnerRelease{Running: runnerV1, Target: runnerV2, Held: vmrunner.HeldUnstaged}
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"))

	nodes["owner-a"].release.Held = vmrunner.HeldFailed
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "a release that failed to take over is not rolled onto")

	nodes["owner-a"].release.Held = vmrunner.HeldRuntime
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"))
	assert.NotContains(t, runnerAnnotations(t, r, "owner-a"), annRunnerRelease, "the rolled pod runs its own image, so no release is named")
}

// TEST_SCENARIO: a runner that does not answer right after it was named a new release is mid hand-off, and its pod is left alone. One that still does not answer long after has a loader that brings up neither the new release nor the old one, and the pod is rolled onto the configured image, the only way its machines get a working runner again.
func TestARunnerThatStaysUnreachableAfterANewReleaseRollsThePod(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t)
	createRolloutRunner(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, "owner-a")
	r.config.VM.Runner.Image = runnerV2
	r.runnerEndpoint = func(string) string { return "https://127.0.0.1:1" }

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "a runner mid hand-off is not rolled")

	setRunnerAnnotation(t, r, "owner-a", annRunnerReleaseNamedAt, time.Now().Add(-runnerReleaseUnreachableRoll-time.Minute).UTC().Format(time.RFC3339))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"))
}

// TEST_SCENARIO: a runner whose hand-off has an outcome keeps its pod's old image for good, so it must not be rolled for a later blip in its answers — least of all onto a release that failed. Once it has answered that it runs the release, or holds it as failed, an unreachable runner long after is left alone.
func TestARunnerThatTookItsReleaseIsNotRolledForALaterBlip(t *testing.T) {
	for _, outcome := range []vmrunner.RunnerRelease{
		{Running: runnerV2, Target: runnerV2},
		{Running: runnerV1, Target: runnerV2, Held: vmrunner.HeldFailed},
	} {
		t.Run(outcome.Held, func(t *testing.T) { aRunnerWithAnOutcomeIsNotRolled(t, outcome) })
	}
}

func aRunnerWithAnOutcomeIsNotRolled(t *testing.T, outcome vmrunner.RunnerRelease) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	createRolloutRunner(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, "owner-a")
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	setRunnerAnnotation(t, r, "owner-a", annRunnerReleaseNamedAt, time.Now().Add(-runnerReleaseUnreachableRoll-time.Minute).UTC().Format(time.RFC3339))

	nodes["owner-a"].release = outcome
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.NotContains(t, runnerAnnotations(t, r, "owner-a"), annRunnerReleaseNamedAt)

	r.runnerEndpoint = func(string) string { return "https://127.0.0.1:1" }
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"))
}

// TEST_SCENARIO: one owner's runner stops answering during a runner release, while its hand-off holds the place in the roll or while it decides whether to take one. Every owner's roll decision shares one lock, so a call to that runner under the lock would hold every other owner's agent starts for the call timeout. Another owner's turn still finishes at once: the hung runner delays only its own owner.
func TestAHungRunnerDuringAReleaseHoldsUpNoOtherOwner(t *testing.T) {
	for name, hangs := range map[string]func(*http.Request) bool{
		"mid hand-off":           func(*http.Request) bool { return true },
		"deciding its own place": func(req *http.Request) bool { return req.URL.Path != "/release" },
	} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			r, _ := setupRolloutReconciler(t)
			for _, owner := range []string{"owner-a", "owner-b"} {
				createRolloutRunner(t, r, owner)
				require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
			}
			r.config.VM.Runner.Image = runnerV2
			if name == "mid hand-off" {
				require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
				require.Equal(t, runnerV2, namedRelease(t, r, "owner-a"))
			}

			entered, release := make(chan struct{}, 1), make(chan struct{})
			hung := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if !hangs(req) {
					_, _ = w.Write([]byte("{}"))
					return
				}
				select {
				case entered <- struct{}{}:
				default:
				}
				<-release
			}))
			t.Cleanup(hung.Close)
			reachable := r.runnerEndpoint
			r.runnerEndpoint = func(owner string) string {
				if owner == "owner-a" {
					return hung.URL
				}
				return reachable(owner)
			}
			delete(r.runners, "owner-a")
			done := make(chan struct{})
			go func() {
				_ = r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), false)
				close(done)
			}()
			t.Cleanup(func() {
				close(release)
				<-done
			})
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("the hung owner's turn never called its runner")
			}

			finished := make(chan struct{})
			go func() {
				_ = r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true)
				close(finished)
			}()
			select {
			case <-finished:
			case <-time.After(2 * time.Second):
				t.Fatal("another owner's turn waited on the hung runner")
			}
		})
	}
}

// TEST_SCENARIO: a new runner release reaches an install where most owners have nothing running, so no agent of theirs reconciles. One sweep takes it to each of them, waiting only for each runner to take it, rather than one owner per sweep. An owner with a ready machine still holds the place until its agents settle the hand-off, so with a width of one the owners after it wait.
func TestOneSweepTakesAReleaseToEveryOwnerWithNothingRunning(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	owners := []string{testOwner, "owner-a", "owner-b", "owner-c", "owner-d"}
	sort.Slice(owners, func(i, j int) bool { return r.runnerName(owners[i]) < r.runnerName(owners[j]) })
	for _, owner := range owners {
		if owner != testOwner {
			createRolloutRunner(t, r, owner)
		}
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
		settleRunnerPod(t, r, owner)
		nodes[owner].release = vmrunner.RunnerRelease{Running: runnerV2, Target: runnerV2}
	}
	busy := owners[3]
	nodes[busy].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes[busy].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.config.VM.Runner.Image = runnerV2

	r.ReconcileRunnerRollout(ctx)
	for i, owner := range owners {
		want := runnerV1
		if i <= 3 {
			want = runnerV2
		}
		assert.Equal(t, want, namedRelease(t, r, owner), "runner %d in name order", i)
	}
}

// TEST_SCENARIO: the sweep follows owners' hand-offs in parallel, as many as the roll is wide, rather than one owner after another. With a width of three and three owners whose runners take the release only after a delay, the sweep names all three before any has taken it, and takes about one delay, not three.
func TestTheSweepFollowsOwnersHandOffsInParallel(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	r.config.VM.Runner.Rollout.MaxConcurrent = 3
	owners := []string{"owner-a", "owner-b", "owner-c"}
	for _, owner := range owners {
		createRolloutRunner(t, r, owner)
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
		settleRunnerPod(t, r, owner)
	}
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, testOwner)
	r.runnerEndpoint(testOwner)
	r.config.VM.Runner.Image = runnerV2
	const takes = 1500 * time.Millisecond
	named := make(chan string, len(owners))
	for _, owner := range owners {
		n := nodes[owner]
		n.mu.Lock()
		n.onName = func() {
			named <- owner
			time.AfterFunc(takes, func() {
				n.mu.Lock()
				n.release = vmrunner.RunnerRelease{Running: runnerV2, Target: runnerV2}
				n.mu.Unlock()
			})
		}
		n.mu.Unlock()
	}
	nodes[testOwner].release = vmrunner.RunnerRelease{Running: runnerV2, Target: runnerV2}

	started := time.Now()
	r.ReconcileRunnerRollout(ctx)
	elapsed := time.Since(started)
	close(named)
	var got []string
	for owner := range named {
		got = append(got, owner)
	}
	assert.ElementsMatch(t, owners, got)
	for _, owner := range owners {
		assert.Equal(t, runnerV2, namedRelease(t, r, owner))
		assert.NotContains(t, runnerAnnotations(t, r, owner), annRunnerHandoffAt, "the sweep followed the hand-off until it settled")
	}
	assert.Less(t, elapsed, 2*takes+takes/2, "the sweep waited for the owners one after another")
}

// TEST_SCENARIO: a release that changes the pod and the image puts one runner mid-roll and mid-hand-off at once. Its hand-off settles while the rolled pod's machine is not back yet. The runner still holds its place by the roll, so another owner's turn, reading the kept view, does not take a second place.
func TestASettledHandOffKeepsARunnerThatIsStillMidRoll(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	for _, owner := range []string{"owner-a", "owner-b"} {
		createRolloutRunner(t, r, owner)
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	}
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.Equal(t, runnerV2, namedRelease(t, r, "owner-a"))
	setRolledAt(t, r, "owner-a", time.Now())
	setRunnerAnnotation(t, r, "owner-a", annRunnerAwaiting, vmAgentCR().Name)
	nodes["owner-a"].release = vmrunner.RunnerRelease{Running: runnerV2, Target: runnerV2}
	r.rollViewTTL = runnerRollViewTTL

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NotContains(t, runnerAnnotations(t, r, "owner-a"), annRunnerHandoffAt, "the hand-off settled")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, namedRelease(t, r, "owner-b"), "the first runner is still mid-roll")
}

// TEST_SCENARIO: a runner pod a controller before this one rendered mounts a release ConfigMap and has a loader that reads only that, so it cannot be named a release over the machine API. Its pod shape differs from the one rendered now, so it rolls once, through the ordinary roll, onto a pod whose loader takes releases over the API; it is never named a release before that, and the roll removes the ConfigMap it no longer mounts.
func TestARunnerPodWithTheOldReleaseMountRollsOnce(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	createRolloutRunner(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, "owner-a")
	deps := r.client.AppsV1().Deployments("test-agents")
	dep, err := deps.Get(ctx, r.runnerName("owner-a"), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Annotations[annRunnerTemplate] = "8f02eee8b0de524a"
	dep.Spec.Template.Spec.Volumes = append(dep.Spec.Template.Spec.Volumes, corev1.Volume{Name: "release"})
	_, err = deps.Update(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
	_, err = r.client.CoreV1().ConfigMaps("test-agents").Create(ctx, &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{
		Name: r.runnerName("owner-a") + legacyRunnerReleaseSuffix, Namespace: "test-agents",
	}}, metav1.CreateOptions{})
	require.NoError(t, err)
	r.config.VM.Runner.Image = runnerV2

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"), "the old pod rolls onto the configured image")
	assert.Empty(t, nodes["owner-a"].named, "a pod whose loader reads the ConfigMap is not named a release")
	_, err = r.client.CoreV1().ConfigMaps("test-agents").Get(ctx, r.runnerName("owner-a")+legacyRunnerReleaseSuffix, metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "the roll removes the old release ConfigMap")
}

// TEST_SCENARIO: the runner template the install has out there carries its own CPU limit and request, and the hash this controller wrote for it covered them, as every hash did before it left CPU out to move it in place. Both vintages shipped: the first covered memory and CPU, the second — the one a runner out there carries now — dropped memory and kept CPU. The reconcile must recognise either as the pod it would render, take the new hash in a metadata-only update, and leave the pod — and so every machine of the owner — alone.
func TestARunnerThatCarriedConfiguredCPUDoesNotRollOnTheUpgrade(t *testing.T) {
	for _, tc := range []struct {
		name   string
		memory bool
	}{
		{name: "memory and cpu", memory: true},
		{name: "cpu alone", memory: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			r, _ := setupRolloutReconciler(t)
			createRolloutRunner(t, r, "owner-a")
			deps := r.client.AppsV1().Deployments("test-agents")
			before, err := deps.Get(ctx, r.runnerName("owner-a"), metav1.GetOptions{})
			require.NoError(t, err)

			// TEST_SCENARIO: the runner the install has out there was rendered with its CPU limit and request, and with the memory its pool gave it, which this head renders only onto the pod in place.
			updated := before.DeepCopy()
			configured := &updated.Spec
			for i := range configured.Template.Spec.Containers {
				c := &configured.Template.Spec.Containers[i]
				c.Resources.Requests[corev1.ResourceCPU] = resource.MustParse("2")
				c.Resources.Requests[corev1.ResourceMemory] = resource.MustParse("8Gi")
				c.Resources.Limits[corev1.ResourceCPU] = resource.MustParse("12")
				c.Resources.Limits[corev1.ResourceMemory] = resource.MustParse("16Gi")
			}
			pod := configured.Template.DeepCopy()

			// TEST_SCENARIO: the stored hash is the pod as that release hashed it: the pod as it rendered it, less the image and the builtin release env, and less the memory the later vintage had already dropped.
			old := configured.DeepCopy()
			for i := range old.Template.Spec.Containers {
				c := &old.Template.Spec.Containers[i]
				c.Image = ""
				for j := range c.Env {
					if c.Env[j].Name == vmRunnerBuiltinEnv {
						c.Env[j].Value = ""
					}
				}
				if !tc.memory {
					delete(c.Resources.Limits, corev1.ResourceMemory)
					delete(c.Resources.Requests, corev1.ResourceMemory)
				}
			}
			stored, err := runnerTemplateHash(*old)
			require.NoError(t, err)
			require.NotEqual(t, stored, before.Annotations[annRunnerTemplate], "the fixture stores the hash this head writes, not the one before it")

			updated.Annotations[annRunnerTemplate] = stored
			_, err = deps.Update(ctx, updated, metav1.UpdateOptions{})
			require.NoError(t, err)

			require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
			after, err := deps.Get(ctx, r.runnerName("owner-a"), metav1.GetOptions{})
			require.NoError(t, err)
			assert.Empty(t, after.Annotations[annRunnerRolledAt], "the runner rolled, rebooting every machine of the owner")
			assert.Equal(t, *pod, after.Spec.Template, "the pod the owner's machines boot on was replaced")
			assert.NotEqual(t, stored, after.Annotations[annRunnerTemplate], "and it took the new hash without rolling")
		})
	}
}

// TEST_SCENARIO: an install that keeps runners off some nodes with a node affinity, which a nodeSelector cannot express, gets it on every runner pod; one that sets none renders no affinity, so the pinned template hash above holds and no runner rolls.
func TestARunnerPodTakesTheInstallsAffinity(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	offGPU := &corev1.Affinity{NodeAffinity: &corev1.NodeAffinity{
		RequiredDuringSchedulingIgnoredDuringExecution: &corev1.NodeSelector{NodeSelectorTerms: []corev1.NodeSelectorTerm{{
			MatchExpressions: []corev1.NodeSelectorRequirement{{Key: "nvidia.com/gpu.present", Operator: corev1.NodeSelectorOpNotIn, Values: []string{"true"}}},
		}}},
	}}
	r.config.VM.Runner.Affinity = offGPU
	require.NoError(t, r.Reconcile(ctx, agent))
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, offGPU, dep.Spec.Template.Spec.Affinity)
}

// TEST_SCENARIO: the roll's width is a count or a share of the install's runners. A share is rounded up, so a share of a few owners still moves one at a time, and a share of none is one rather than none.
func TestTheRollWidthIsACountOrAShareOfTheInstall(t *testing.T) {
	for _, tc := range []struct {
		name      string
		count     int
		percent   int
		total     int
		wantWidth int
	}{
		{name: "the count", count: 3, total: 100, wantWidth: 3},
		{name: "a share", percent: 10, total: 100, wantWidth: 10},
		{name: "a share rounds up", percent: 10, total: 91, wantWidth: 10},
		{name: "a share of a few owners moves one", percent: 5, total: 3, wantWidth: 1},
		{name: "a share of no owner is one", percent: 50, total: 0, wantWidth: 1},
		{name: "a share wins over the count", count: 1, percent: 100, total: 4, wantWidth: 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.wantWidth, runnerRollWidth(config.VMRunnerSpec{Rollout: config.VMRunnerRollout{
				MaxConcurrent: tc.count, MaxConcurrentPercent: tc.percent,
			}}, tc.total))
		})
	}
}

// TEST_SCENARIO: an install too large for one runner at a time states the roll's width as a share of its runners. This one has five, and half of them is three: three runners roll at once and the rest wait, where `maxConcurrent: 1` would move them one at a time.
func TestARollWidthInPercentRollsThatManyOwnersAtOnce(t *testing.T) {
	ctx := context.Background()
	const ours = "owner-d"
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-b", "owner-c", ours)
	r.config.VM.Runner.Rollout.MaxConcurrent = 1
	r.config.VM.Runner.Rollout.MaxConcurrentPercent = 50
	changeRunnerPod(r)
	_, total, err := r.runnersMidRoll(ctx)
	require.NoError(t, err)
	require.Equal(t, 5, total)
	assert.Equal(t, 3, runnerRollWidth(r.config.VM.Runner, total))

	for _, owner := range []string{"owner-a", "owner-b", "owner-c", ours} {
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	}
	for _, owner := range []string{"owner-a", "owner-b", "owner-c"} {
		assert.Equal(t, runnerV2, runnerImageOf(t, r, owner), "half of five rounds up to three runners mid-roll")
	}
	assert.Equal(t, runnerV1, runnerImageOf(t, r, ours), "the fourth runner waits for a place")

	setRolledAt(t, r, "owner-a", time.Now())
	settleRunnerPod(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, ours, r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, ours), "a settled roll frees its place")
}

// TEST_SCENARIO: a release declares that the machines booted before it must reboot onto it, which a hand-off cannot do: the runner holds the release as `reboot`, the hand-off ends, and the pod rolls onto it, which reboots its machines. That roll waits for no busy agent, since a machine booted by the release is the point.
func TestAReleaseWhoseMachinesMustRebootRollsThePodWithoutWaitingForIdle(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	createRolloutRunner(t, r, testOwner)
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, testOwner)
	nodes[testOwner].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.busyProbe = func(context.Context, string) bool { return true }
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	require.Equal(t, []string{runnerV2}, nodes[testOwner].named, "the release is named first, as any release is")
	nodes[testOwner].release = vmrunner.RunnerRelease{Running: runnerV1, Target: runnerV2, Held: vmrunner.HeldReboot}

	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, testOwner), "the pod rolls onto the release, which reboots the machine")
	assert.NotContains(t, runnerAnnotations(t, r, testOwner), annRunnerBusy, "the roll waits for no agent's turn")
	assert.Equal(t, []string{runnerV2}, nodes[testOwner].named, "the hand-off ends: the release is not named again")

	settleRunnerPod(t, r, testOwner)
	nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	assert.NotContains(t, runnerAnnotations(t, r, testOwner), annRunnerRolledAt, "the roll settles once the machine is back on the new pod")
}

// TEST_SCENARIO: the bypass a reboot release gets is its own roll's, never another roll's: a changed pod shape rolls for a reason of its own, so it waits for a busy agent even while the runner holds the release as one that reboots its machines, which that roll is not.
func TestAChangedPodStillWaitsForIdleWithARebootReleasePending(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	nodes["owner-a"].specs["busy"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("busy", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.busyProbe = func(_ context.Context, id string) bool { return id == "busy" }
	changeRunnerPod(r)
	nodes["owner-a"].release = vmrunner.RunnerRelease{Running: runnerV1, Target: runnerV2, Held: vmrunner.HeldReboot}

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "an agent mid-turn holds a shape change, a reboot release or not")
	assert.Contains(t, runnerAnnotations(t, r, "owner-a"), annRunnerBusy)
	assert.Empty(t, nodes["owner-a"].named, "a release that reboots machines is not handed off")
}

// TEST_SCENARIO: a reboot release rolls forward and back, as a rollback deploys the release before it: each rolls the owner's pod, and the machine that was up is up again on the new pod. The rollback is what an operator reaches for when the candidate is wrong, so the way back costs the same roll the way there did.
func TestARebootReleaseRollsForwardAndBack(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	createRolloutRunner(t, r, testOwner)
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, testOwner)
	nodes[testOwner].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})

	running := runnerV1
	roll := func(t *testing.T, want string) {
		t.Helper()
		r.config.VM.Runner.Image = want
		require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
		require.Equal(t, want, namedRelease(t, r, testOwner), "the release is named, and held as one that reboots")
		nodes[testOwner].release = vmrunner.RunnerRelease{Running: running, Target: want, Held: vmrunner.HeldReboot}

		require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
		assert.Equal(t, want, runnerImageOf(t, r, testOwner), "the pod rolls onto the release")
		settleRunnerPod(t, r, testOwner)
		nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
		require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
		assert.NotContains(t, runnerAnnotations(t, r, testOwner), annRunnerRolledAt, "the roll settles once the machine is back")
		running = want
	}

	roll(t, runnerV2)
	roll(t, runnerV1)
	assert.Equal(t, []string{runnerV2, runnerV1}, nodes[testOwner].named, "one hand-off named forward, one back, and neither took")
}

// TEST_SCENARIO: a reboot release rolls within the roll's width, as any release does. With two owners and a width of one, the first owner's runner rolls onto the release and the second keeps its pod and its machines until the first roll settles; then the second rolls too.
func TestARebootReleaseRollsOneOwnerAtATime(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	for _, owner := range []string{"owner-a", "owner-b"} {
		nodes[owner].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
		nodes[owner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	}
	r.config.VM.Runner.Rollout.MaxConcurrent = 1
	r.config.VM.Runner.Image = runnerV2
	for _, owner := range []string{"owner-a", "owner-b"} {
		nodes[owner].release = vmrunner.RunnerRelease{Running: runnerV1, Target: runnerV2, Held: vmrunner.HeldReboot}
	}

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"), "the first owner's runner rolls onto the release")
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "the second waits for a place in the roll")

	setRolledAt(t, r, "owner-a", time.Now())
	settleRunnerPod(t, r, "owner-a")
	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"), "a settled roll frees its place")
}

// TEST_SCENARIO: a roll stalls on a release whose pods crash-loop, and the fleet shrinks under it, so the share the roll was handed out at no longer holds the runners that are mid-roll. A runner already mid-roll replaces its failed target in the place it holds, so a corrective pod shape still reaches it.
func TestAStalledRollKeepsItsPlaceWhenTheFleetShrinks(t *testing.T) {
	ctx := context.Background()
	owners := []string{"owner-a", "owner-b", "owner-c", "owner-d", "owner-e"}
	r, _ := setupRolloutReconciler(t, owners...)
	r.config.VM.Runner.Rollout.MaxConcurrent = 1
	r.config.VM.Runner.Rollout.MaxConcurrentPercent = 50
	changeRunnerPod(r)
	for _, owner := range owners {
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	}
	var broken, idle []string
	for _, owner := range owners {
		if _, rolled := runnerAnnotations(t, r, owner)[annRunnerRolledAt]; rolled {
			broken = append(broken, owner)
		} else {
			idle = append(idle, owner)
		}
	}
	require.Len(t, broken, 3, "half of five rounds up to three, and their pods never became ready")
	for _, owner := range idle {
		require.NoError(t, r.client.AppsV1().Deployments("test-agents").Delete(ctx, r.runnerName(owner), metav1.DeleteOptions{}))
	}
	old := time.Now().Add(-time.Hour)
	for _, owner := range broken {
		setRolledAt(t, r, owner, old)
	}

	r.config.VM.Runner.BootMiB += 512
	for _, owner := range broken {
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	}
	for _, owner := range broken {
		assert.NotEqual(t, old.UTC().Format(time.RFC3339), runnerAnnotations(t, r, owner)[annRunnerRolledAt], "a runner mid-roll takes a corrective roll in the place it holds, where a share of a shrunken fleet would hold all three back")
	}
}

// TEST_SCENARIO: a release breaks and leaves three runners mid-hand-off, and an owner is removed so the share shrinks to two places under them. A corrected release reaches every one of them: a runner already mid-hand-off takes it in the place it holds, where counting its peers alone would leave all three on the broken release.
func TestAShrunkenShareStillOffersAStuckRunnerTheCorrectedRelease(t *testing.T) {
	ctx := context.Background()
	owners := []string{"owner-a", "owner-b", "owner-c", "owner-d", "owner-e"}
	r, _ := setupRolloutReconciler(t, owners...)
	r.config.VM.Runner.Rollout.MaxConcurrent = 1
	r.config.VM.Runner.Rollout.MaxConcurrentPercent = 50
	r.config.VM.Runner.Image = runnerV2
	for _, owner := range owners {
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	}
	var stuck, idle []string
	for _, owner := range owners {
		if namedRelease(t, r, owner) == runnerV2 {
			stuck = append(stuck, owner)
		} else {
			idle = append(idle, owner)
		}
	}
	require.Len(t, stuck, 3, "half of six runners is three, and none of them took the release")
	for _, owner := range idle {
		require.NoError(t, r.client.AppsV1().Deployments("test-agents").Delete(ctx, r.runnerName(owner), metav1.DeleteOptions{}))
	}
	_, total, err := r.runnersMidRoll(ctx)
	require.NoError(t, err)
	require.Equal(t, 4, total)
	require.Equal(t, 2, runnerRollWidth(r.config.VM.Runner, total), "half of four is smaller than the three runners stuck on the broken release")

	const corrected = "quay.io/dam-agents/vm-runner:3"
	r.config.VM.Runner.Image = corrected
	for _, owner := range stuck {
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	}
	for _, owner := range stuck {
		assert.Equal(t, corrected, namedRelease(t, r, owner), "a runner mid-hand-off takes the corrected release in the place it holds")
	}
}

// TEST_SCENARIO: a release that must reboot its machines is named, and the sweep settles that hand-off as the loader holds it, as it does for an owner with nothing running; the pod roll that follows finds no free place in the width. The time the release was named survives that turn. A loader that then stops answering the release read leaves the pod alone while that time is fresh, and the pod rolls once it passes the unreachable timeout.
func TestARebootHoldKeepsTheTimeItsReleaseWasNamedUntilThePodRolls(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	r.config.VM.Runner.Rollout.MaxConcurrent = 1
	for _, owner := range []string{"owner-a", "owner-b"} {
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	}
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.Equal(t, runnerV2, namedRelease(t, r, "owner-a"))
	nodes["owner-a"].release = vmrunner.RunnerRelease{Running: runnerV1, Target: runnerV2, Held: vmrunner.HeldReboot}
	r.followIdleRunnerHandoff(ctx, "owner-a")
	require.NotContains(t, runnerAnnotations(t, r, "owner-a"), annRunnerHandoffAt, "the hand-off ended on the hold, and its place with it")
	setRolledAt(t, r, "owner-b", time.Now())
	setRunnerAnnotation(t, r, "owner-b", annRunnerAwaiting, vmAgentCR().Name)

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "the width's one place is the other runner's")
	assert.Contains(t, runnerAnnotations(t, r, "owner-a"), annRunnerReleaseNamedAt, "a pod roll that takes no place yet keeps the time its release was named")

	require.NoError(t, r.client.AppsV1().Deployments("test-agents").Delete(ctx, r.runnerName("owner-b"), metav1.DeleteOptions{}))
	reads := nodes["owner-a"].releaseReadCount()
	nodes["owner-a"].refuseReleaseReads()
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Greater(t, nodes["owner-a"].releaseReadCount(), reads, "the controller read the release again, and the read failed")
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "a loader that has only just stopped answering keeps its pod")

	setRunnerAnnotation(t, r, "owner-a", annRunnerReleaseNamedAt, time.Now().Add(-runnerReleaseUnreachableRoll-time.Minute).UTC().Format(time.RFC3339))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"), "the runner that never answered is rolled onto the release it was named")
}

// UNIT_BOUNDARY_DESCRIPTION: a ReplicaSet of a runner Deployment, as the Deployment controller leaves one: the pod template the Deployment holds now with the `pod-template-hash` label the controller generates written into it and its selector, selected by the runner's own labels, controlled by the Deployment, and reporting the condition admission gave it. The generated label is what a real ReplicaSet carries and its Deployment does not.
func runnerReplicaSet(t *testing.T, r *AgentReconciler, owner, reason string, mutate ...func(*appsv1.ReplicaSet)) *appsv1.ReplicaSet {
	t.Helper()
	dep := runnerDeploymentOf(t, r, owner)
	raw, err := json.Marshal(dep.Spec.Template)
	require.NoError(t, err)
	sum := fnv.New32a()
	_, err = sum.Write(raw)
	require.NoError(t, err)
	hash := rand.SafeEncodeString(fmt.Sprint(sum.Sum32()))
	controller := true
	selector := dep.Spec.Selector.DeepCopy()
	if selector.MatchLabels == nil {
		selector.MatchLabels = map[string]string{}
	}
	selector.MatchLabels[appsv1.DefaultDeploymentUniqueLabelKey] = hash
	template := *dep.Spec.Template.DeepCopy()
	template.Labels[appsv1.DefaultDeploymentUniqueLabelKey] = hash
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:            dep.Name + "-" + hash,
			Namespace:       dep.Namespace,
			Labels:          vmRunnerSelector(owner),
			OwnerReferences: []metav1.OwnerReference{{APIVersion: "apps/v1", Kind: "Deployment", Name: dep.Name, UID: dep.UID, Controller: &controller}},
		},
		Spec: appsv1.ReplicaSetSpec{Selector: selector, Template: template},
	}
	for _, m := range mutate {
		m(rs)
	}
	if reason != "" {
		rs.Status.Conditions = []appsv1.ReplicaSetCondition{{
			Type:    appsv1.ReplicaSetReplicaFailure,
			Status:  corev1.ConditionTrue,
			Reason:  reason,
			Message: `.containers[0].capabilities.add: Invalid value: "SYS_RESOURCE": capability may not be added`,
		}}
	}
	created, err := r.client.AppsV1().ReplicaSets(dep.Namespace).Create(context.Background(), rs, metav1.CreateOptions{})
	require.NoError(t, err)
	return created
}

// UNIT_BOUNDARY_DESCRIPTION: the container image a runner's Deployment carries, written without going through the roll, which is what a test needs to place a peer on an image other than the install's.
func setRunnerImage(t *testing.T, r *AgentReconciler, owner, image string) {
	t.Helper()
	dep := runnerDeploymentOf(t, r, owner)
	dep.Spec.Template.Spec.Containers[0].Image = image
	_, err := r.client.AppsV1().Deployments("test-agents").Update(context.Background(), dep, metav1.UpdateOptions{})
	require.NoError(t, err)
}

// UNIT_BOUNDARY_DESCRIPTION: a runner peer that already runs the candidate pod template and reports its pod ready, which is what proves that template is admitted. It is settled on the new template, so a peer built before the change describes the old one and proves nothing about the new.
func readyRunnerOnCandidate(t *testing.T, r *AgentReconciler, owner string) {
	t.Helper()
	ctx := context.Background()
	require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, owner)
	require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, owner)
}

// TEST_SCENARIO: one owner's rolled pod is refused at admission while another owner's runner already runs the very template that was refused and is ready. The refusal therefore names an object of that owner's own and not the release, so past the settle timeout the roll moves on and the next owner's runner rolls.
func TestARunnerRefusedBesideAReadyPeerOnTheSameTemplateDoesNotStallTheRoll(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-peer", "owner-b")
	changeRunnerPod(r)
	readyRunnerOnCandidate(t, r, "owner-peer")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	runnerReplicaSet(t, r, "owner-a", "FailedCreate")
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"))
}

// TEST_SCENARIO: a rolled owner has no pod at all and its ReplicaSet records no admission refusal, which is a release whose pod never got created rather than one owner's refusal. The roll keeps its place, so the next owner does not roll onto it.
func TestARunnerWithNoPodAndNoRefusalHaltsTheRoll(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-peer", "owner-b")
	changeRunnerPod(r)
	readyRunnerOnCandidate(t, r, "owner-peer")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	runnerReplicaSet(t, r, "owner-a", "")
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"))
}

// TEST_SCENARIO: a release breaks the runner pod shape, so admission refuses every owner's create and the first rolled runner has no pod and a FailedCreate. No peer runs that template, so the refusal is the release's and not one owner's: the roll keeps its place, the next owner does not roll, and the stalled runner is marked. That is the halt the design intends, kept for a truly broken release.
func TestARefusalThatBreaksEveryRunnerHaltsTheRoll(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-b")
	changeRunnerPod(r)
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	runnerReplicaSet(t, r, "owner-a", "FailedCreate")
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "no peer runs the template, so the refusal halts the roll")
	assert.NotEmpty(t, runnerAnnotations(t, r, "owner-a")[annRunnerStalled])
}

// TEST_SCENARIO: the release changes the runner image, which admission can refuse for a registry or a digest it does not allow, and every peer runs the same pod on a different image. A ready peer that never admitted this image proves nothing about it, so the refused runner keeps its place: a peer's image is part of what a peer proves.
func TestAReadyPeerOnAnotherImageDoesNotReleaseTheRoll(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-peer")
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-peer", r.runnerOwnerRef(ctx), true))
	setRunnerImage(t, r, "owner-peer", "quay.io/dam-agents/vm-runner:peer")
	settleRunnerPod(t, r, "owner-peer")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	setRunnerImage(t, r, "owner-a", runnerV2)
	runnerReplicaSet(t, r, "owner-a", "FailedCreate")
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))

	assert.False(t, r.runnerPodRefusedForItsOwner(ctx, runnerDeploymentOf(t, r, "owner-a")), "a peer on another image says nothing of the refused one")
	assert.Contains(t, midRoll(t, r), r.runnerName("owner-a"), "so the refused runner keeps its place")
}

// TEST_SCENARIO: an older ReplicaSet of the same runner Deployment was refused for a pod the Deployment no longer asks for — an older image. That failure describes another pod, so it is not this roll's refusal: the roll keeps its place.
func TestARefusalOfAnOlderPodShapeDoesNotReleaseTheRoll(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-peer")
	changeRunnerPod(r)
	readyRunnerOnCandidate(t, r, "owner-peer")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	runnerReplicaSet(t, r, "owner-a", "FailedCreate", func(rs *appsv1.ReplicaSet) {
		rs.Spec.Template.Spec.Containers[0].Image = runnerV1
	})
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))

	assert.False(t, r.runnerPodRefusedForItsOwner(ctx, runnerDeploymentOf(t, r, "owner-a")), "a refused older revision is not this roll's refusal")
	assert.Contains(t, midRoll(t, r), r.runnerName("owner-a"), "so the roll keeps its place")
}

// UNIT_BOUNDARY_DESCRIPTION: the runners the controller reads as mid-roll right now, which is the list its width is counted against.
func midRoll(t *testing.T, r *AgentReconciler) []string {
	t.Helper()
	rolling, _, err := r.runnersMidRoll(context.Background())
	require.NoError(t, err)
	return rolling
}

// TEST_SCENARIO: a release whose new pod never becomes ready on one owner, while another owner's runner is already ready on that pod, halts the roll at that runner — but only for `rollout.stalledTimeout`. Past it the stalled runner gives up its place, keeps its stalled mark and gains a Warning Event, and the next owner's runner rolls, so one owner's stall does not freeze every owner's upgrade.
func TestAStalledRollGivesUpItsPlaceAtTheStalledTimeout(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-peer", "owner-b")
	changeRunnerPod(r)
	readyRunnerOnCandidate(t, r, "owner-peer")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "the roll halts at the first runner while the stall is fresh")
	assert.NotEmpty(t, runnerAnnotations(t, r, "owner-a")[annRunnerStalled])

	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerStalledTimeout-time.Minute))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"), "past the stalled timeout the place is released")
	annotations := runnerAnnotations(t, r, "owner-a")
	assert.NotEmpty(t, annotations[annRunnerStalled], "the stalled mark stays, as the signal that this runner's release went no further")
	assert.Empty(t, annotations[annRunnerRolledAt], "the roll that gave up its place is no longer mid-roll")
	events := eventsOn(t, r, r.runnerName("owner-a"))
	require.NotEmpty(t, events, "a stalled roll is legible in `kubectl get events`")
	assert.Equal(t, string(corev1.EventTypeWarning), events[len(events)-1].Type)
	assert.Equal(t, reasonRollStallGivenUp, events[len(events)-1].Reason)
}

// TEST_SCENARIO: a runner that gave up its stalled place is still on the release it ran before, and its pod rolling ready again is what clears the mark: the next pass that sees the pod ready settles the roll and removes the sign that anything was ever wrong.
func TestARunnerThatGaveUpItsPlaceClearsItsMarkWhenItsPodIsReady(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-b")
	changeRunnerPod(r)
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerStalledTimeout-time.Minute))
	setRunnerAnnotation(t, r, "owner-a", annRunnerStalled, time.Now().UTC().Format(time.RFC3339))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	require.NotEmpty(t, runnerAnnotations(t, r, "owner-a")[annRunnerStalled])

	settleRunnerPod(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Empty(t, runnerAnnotations(t, r, "owner-a")[annRunnerStalled])
}

// TEST_SCENARIO: the dev incident itself. A release adds a capability the security policy does not allow, so admission refuses every owner's new pod: the first rolled runner has no pod, an owned FailedCreate, and no peer that runs its pod shape. No runner on the new pod has ever become ready, so the refusal is the release's: the roll halts at the first runner, which is marked once with a Warning Event, and it keeps its place far past `rollout.stalledTimeout`, so no second owner loses its runner to the same release.
func TestARefusalOfEveryNewPodNeverRollsASecondOwner(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-b", "owner-c")
	changeRunnerPod(r)
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	runnerReplicaSet(t, r, "owner-a", "FailedCreate")
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	require.NotEmpty(t, runnerAnnotations(t, r, "owner-a")[annRunnerStalled])

	setRolledAt(t, r, "owner-a", time.Now().Add(-10*defaultRunnerStalledTimeout))
	for range 3 {
		for _, owner := range []string{"owner-a", "owner-b", "owner-c"} {
			require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
		}
	}
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "no runner on the new pod is ready, so the release goes no further")
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-c"))
	assert.Contains(t, midRoll(t, r), r.runnerName("owner-a"), "the stalled runner keeps its place")
	var stalled, givenUp int
	for _, event := range eventsOn(t, r, r.runnerName("owner-a")) {
		switch event.Reason {
		case reasonRollStalled:
			stalled++
		case reasonRollStallGivenUp:
			givenUp++
		}
	}
	assert.Equal(t, 1, stalled, "a stall is reported once")
	assert.Zero(t, givenUp, "a place that is kept is not reported as given up")
}

// TEST_SCENARIO: the write that releases a stalled place is refused, beside a ready peer on the same pod, so the runner still holds its annotations. A place that is still taken must stay taken: the next owner does not roll, no give-up Event is written for a transition that did not land, and a later pass that lands the write releases the place with one Event.
func TestAFailedGiveUpWriteKeepsThePlace(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-peer", "owner-b")
	changeRunnerPod(r)
	readyRunnerOnCandidate(t, r, "owner-peer")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	require.NotEmpty(t, runnerAnnotations(t, r, "owner-a")[annRunnerStalled])
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerStalledTimeout-time.Minute))

	cs := r.client.(*fake.Clientset)
	refused := true
	cs.PrependReactor("update", "deployments", func(action k8stesting.Action) (bool, runtime.Object, error) {
		dep := action.(k8stesting.UpdateAction).GetObject().(*appsv1.Deployment)
		if !refused || dep.Annotations[annRunnerRolledAt] != "" {
			return false, nil, nil
		}
		return true, nil, k8serrors.NewConflict(appsv1.Resource("deployments"), dep.Name, errors.New("the informer's copy is older"))
	})

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "a place whose release did not land is still taken")
	assert.NotEmpty(t, runnerAnnotations(t, r, "owner-a")[annRunnerRolledAt], "the annotations the release would have cleared are still there")
	for _, event := range eventsOn(t, r, r.runnerName("owner-a")) {
		assert.NotEqual(t, reasonRollStallGivenUp, event.Reason, "a release that did not land is not reported")
	}

	refused = false
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"), "the pass that lands the release frees the place")
	givenUp := 0
	for _, event := range eventsOn(t, r, r.runnerName("owner-a")) {
		if event.Reason == reasonRollStallGivenUp {
			givenUp++
		}
	}
	assert.Equal(t, 1, givenUp)
}

// TEST_SCENARIO: the write that records a stall is refused, so nothing on the runner says it is stalled. That attempt reports nothing: a transition that did not land is not announced, and the next pass that lands it writes one Event, never the same one twice.
func TestAStallThatCannotBeRecordedSaysNothing(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-b")
	changeRunnerPod(r)
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))

	cs := r.client.(*fake.Clientset)
	refused := true
	cs.PrependReactor("update", "deployments", func(action k8stesting.Action) (bool, runtime.Object, error) {
		dep := action.(k8stesting.UpdateAction).GetObject().(*appsv1.Deployment)
		if !refused || dep.Annotations[annRunnerStalled] == "" {
			return false, nil, nil
		}
		return true, nil, k8serrors.NewConflict(appsv1.Resource("deployments"), dep.Name, errors.New("the informer's copy is older"))
	})

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	assert.Empty(t, runnerAnnotations(t, r, "owner-a")[annRunnerStalled], "the mark did not land")
	assert.Empty(t, eventsOn(t, r, r.runnerName("owner-a")), "a stall that was not recorded is not announced")

	refused = false
	for range 2 {
		require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
	}
	assert.NotEmpty(t, runnerAnnotations(t, r, "owner-a")[annRunnerStalled])
	stalled := 0
	for _, event := range eventsOn(t, r, r.runnerName("owner-a")) {
		if event.Reason == reasonRollStalled {
			stalled++
		}
	}
	assert.Equal(t, 1, stalled, "the transition is announced once, on the pass that records it")
}

// TEST_SCENARIO: the last changed runner of an upgrade has no ready machine, so its roll writes no awaiting list and no other owner asks for a roll place; a peer is already ready on its pod. Its own turn must still bound the stall: past the settle timeout it is marked and gets its Event, and past the stalled timeout it gives up the place, so a place cannot outlive its bound just because no one else asked.
func TestTheLastRunnerWithNoMachinesIsStillBounded(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-peer")
	changeRunnerPod(r)
	readyRunnerOnCandidate(t, r, "owner-peer")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	require.Empty(t, runnerAnnotations(t, r, "owner-a")[annRunnerAwaiting], "a runner with no ready machine waits on no machine")
	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.NotEmpty(t, runnerAnnotations(t, r, "owner-a")[annRunnerStalled], "its own turn marks the stall")

	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerStalledTimeout-time.Minute))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	annotations := runnerAnnotations(t, r, "owner-a")
	assert.Empty(t, annotations[annRunnerRolledAt], "its own turn gives up the place past the bound")
	assert.NotEmpty(t, annotations[annRunnerStalled], "the stalled mark stays")
}
