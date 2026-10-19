// TEST_OVERVIEW: a runner's machines are its processes, so a change to the runner pod reboots every machine of that owner. The controller must create a new owner's runner at once, leave a runner alone while its rendered pod is unchanged, and roll a changed pod to at most `rollout.maxConcurrent` runners at a time, each holding its place until its new pod is ready and the machines that were ready before are ready again — or until the settle timeout says it never will be.
package reconciler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/equality"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
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
	assert.Equal(t, "d8a60be9a6efa104", dep.Annotations[annRunnerTemplate])
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

// TEST_SCENARIO: a release whose fix only a machine that booted it has is marked `rollout.rebootRequired`. Its runners roll onto it instead of handing off, so their machines reboot onto the release, and the roll does not wait for a busy agent: a hand-off would leave every running machine on the runtime it booted for as long as the owner keeps working, which is a day at most.
func TestAReleaseMarkedRebootRequiredRollsThePodsWithoutWaitingForIdle(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	createRolloutRunner(t, r, testOwner)
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, testOwner)
	nodes[testOwner].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.busyProbe = func(context.Context, string) bool { return true }
	r.config.VM.Runner.Image = runnerV2
	r.config.VM.Runner.Rollout.RebootRequired = true

	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, testOwner), "the pod rolls onto the release, rebooting the machine")
	assert.Empty(t, nodes[testOwner].named, "nothing is handed off: a machine booted by the release is the point")
	assert.NotContains(t, runnerAnnotations(t, r, testOwner), annRunnerBusy, "the roll waits for no agent's turn")

	settleRunnerPod(t, r, testOwner)
	nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	assert.NotContains(t, runnerAnnotations(t, r, testOwner), annRunnerRolledAt, "the roll settles once the machine is back on the new pod")
}

// TEST_SCENARIO: a release reaches every owner, and the one before it is put back — a rollback — with a machine live on each. The machines keep running throughout, because the release reaches the pod in place and no pod rolls: what a rollback must not cost is the guests.
func TestAReleaseRollsForwardAndBackWithALiveMachine(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	createRolloutRunner(t, r, testOwner)
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, testOwner)
	nodes[testOwner].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})

	handOff := func(t *testing.T, want string) {
		t.Helper()
		r.config.VM.Runner.Image = want
		require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
		require.Equal(t, want, namedRelease(t, r, testOwner), "the release is named over the machine API")
		nodes[testOwner].release = vmrunner.RunnerRelease{Running: want, Target: want}
		backdateHandoff(t, r, testOwner, runnerHandoffObserve+time.Second)
		require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
		require.NotContains(t, runnerAnnotations(t, r, testOwner), annRunnerHandoffAt, "the hand-off settles")
		assert.Equal(t, runnerV1, runnerImageOf(t, r, testOwner), "no pod rolled, so no machine rebooted")
		nodes[testOwner].mu.Lock()
		ready := nodes[testOwner].statuses["my-agent"].Ready
		nodes[testOwner].mu.Unlock()
		assert.True(t, ready, "the guest is still up")
	}

	handOff(t, runnerV2)
	handOff(t, runnerV1)
	assert.Equal(t, []string{runnerV2, runnerV1}, nodes[testOwner].named, "one hand-off forward, one back")
}

// TEST_SCENARIO: the mark is what drops the wait, not the change itself. The same changed pod, with an agent mid-turn, is held while the release is a hand-off and rolls at once once the release is marked `rebootRequired`.
func TestTheRebootRequiredMarkIsWhatDropsTheIdleWait(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	nodes["owner-a"].specs["busy"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("busy", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.busyProbe = func(_ context.Context, id string) bool { return id == "busy" }
	changeRunnerPod(r)

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "an agent mid-turn holds the roll")
	assert.Contains(t, runnerAnnotations(t, r, "owner-a"), annRunnerBusy)

	r.config.VM.Runner.Rollout.RebootRequired = true
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"), "a marked release reboots the machine mid-turn rather than wait")
}

// TEST_SCENARIO: a marked release rolls forward and back, as a rollback deploys the release before it: each rolls the owner's pod, and the machine that was up is up again on the new pod. The rollback is what an operator reaches for when the candidate is wrong, so the way back costs the same roll the way there did.
func TestAMarkedReleaseRollsForwardAndBack(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	createRolloutRunner(t, r, testOwner)
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, testOwner)
	nodes[testOwner].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.config.VM.Runner.Rollout.RebootRequired = true

	roll := func(t *testing.T, want string) {
		t.Helper()
		r.config.VM.Runner.Image = want
		require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
		assert.Equal(t, want, runnerImageOf(t, r, testOwner), "the marked release rolls the pod")
		settleRunnerPod(t, r, testOwner)
		nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
		require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
		assert.NotContains(t, runnerAnnotations(t, r, testOwner), annRunnerRolledAt, "the roll settles once the machine is back")
	}

	roll(t, runnerV2)
	roll(t, runnerV1)
	assert.Empty(t, nodes[testOwner].named, "no release was handed off: every machine booted the release it needed")
}
