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
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

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

// TEST_SCENARIO: a new runner image reaches an install with two owners. The first owner's runner rolls, and the second keeps its old pod — and every machine on it — until the first runner's new pod is ready and the machine that was ready before the roll answers again.
func TestAChangedRunnerPodRollsOneOwnerAtATime(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	nodes["owner-a"].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.config.VM.Runner.Image = runnerV2

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
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))

	issueRunnerTLS(t, r, "owner-new")
	_, _, err := r.ensureRunner(ctx, "owner-new")
	require.NoError(t, err)
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-new"))
}

// TEST_SCENARIO: every vm agent reconciles its owner's runner about once a minute. While the rendered pod is unchanged the Deployment is not written at all, so nothing on it moves and no roll can start by accident.
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
	r.config.VM.Runner.Image = runnerV2

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
	r.config.VM.Runner.Image = runnerV2
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
	r.config.VM.Runner.Image = runnerV2
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
	r.config.VM.Runner.Image = runnerV2

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
	r.config.VM.Runner.Image = runnerV2

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
	r.config.VM.Runner.Image = runnerV2
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
			r.config.VM.Runner.Image = runnerV2
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
	r.config.VM.Runner.Image = runnerV2
	cs := r.client.(*fake.Clientset)
	cs.ClearActions()

	r.ReconcileRunnerRollout(ctx)

	lists := 0
	for _, a := range cs.Actions() {
		if a.GetVerb() == "list" && a.GetResource().Resource == "deployments" {
			lists++
		}
	}
	assert.Equal(t, 2, lists, "one List for the sweep's own order, one for the runners mid-roll")
}

// TEST_SCENARIO: every runner is rolled when this hash changes, which reboots every vm machine of the install. A change to how the controller renders the runner pod must therefore be deliberate: this pins the hash for a fixed configuration, so an unintended rendering change fails here rather than in a fleet-wide reboot.
func TestTheRunnerTemplateHashIsPinned(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.Reconcile(ctx, agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "07055f57c0ff3bb8", dep.Annotations[annRunnerTemplate])
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

// TEST_SCENARIO: with releases staged on the node, a new runner image is not a changed pod. Every owner's pod keeps its image and every machine on it, and each owner's release ConfigMap names the new image, which the pod's loader takes in place — one owner at a time, as a pod roll goes: the second owner is named the release only once the first runner reports it running and its machine that was ready is ready again.
func TestANewRunnerImageReachesEveryOwnerWithoutAPodRoll(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	r.config.VM.Runner.ReleaseHostPath = "/var/lib/platform-runner-releases"
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
	assert.Equal(t, runnerV1, namedRelease(t, r, "owner-b"), "only one runner hands off at a time")

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
		cm, err := r.client.CoreV1().ConfigMaps("test-agents").Get(ctx, r.runnerReleaseName(owner), metav1.GetOptions{})
		require.NoError(t, err)
		require.Len(t, cm.OwnerReferences, 1)
		assert.Equal(t, r.runnerName(owner), cm.OwnerReferences[0].Name)
	}
}

// TEST_SCENARIO: a runner release that runs but refuses every ensure must not reach every owner. The first owner's runner reports the release running and its machine still ready, an agent's ensure is refused, and the hand-off stalls: the second owner's ConfigMap keeps the old release while the stall stands. An operator removing the stall annotation lets the release go on.
func TestARunnerReleaseThatRefusesEnsuresGoesNoFurther(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	r.config.VM.Runner.ReleaseHostPath = "/var/lib/platform-runner-releases"
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

	cms := r.client.CoreV1().ConfigMaps("test-agents")
	cm, err := cms.Get(ctx, r.runnerReleaseName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	require.Contains(t, cm.Annotations, annRunnerHandoffStalled)
	delete(cm.Annotations, annRunnerHandoffStalled)
	_, err = cms.Update(ctx, cm, metav1.UpdateOptions{})
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
			n.release = vmrunner.RunnerRelease{Running: runnerV1, Target: runnerV2, Held: vmrunner.HeldUnstaged}
			backdateHandoff(t, r, "owner-a", defaultRunnerSettleTimeout+time.Minute)
		},
	} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			r, nodes := setupRolloutReconciler(t)
			r.config.VM.Runner.ReleaseHostPath = "/var/lib/platform-runner-releases"
			for _, owner := range []string{"owner-a", "owner-b"} {
				createRolloutRunner(t, r, owner)
				require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
			}
			r.config.VM.Runner.Image = runnerV2
			require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
			trouble(t, r, nodes["owner-a"])

			require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
			cm, err := r.client.CoreV1().ConfigMaps("test-agents").Get(ctx, r.runnerReleaseName("owner-a"), metav1.GetOptions{})
			require.NoError(t, err)
			assert.Contains(t, cm.Annotations, annRunnerHandoffStalled)
			require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b", r.runnerOwnerRef(ctx), true))
			assert.Equal(t, runnerV1, namedRelease(t, r, "owner-b"), "a stalled hand-off halts the release")

			const runnerV3 = "quay.io/dam-agents/vm-runner:3"
			r.config.VM.Runner.Image = runnerV3
			require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
			assert.Equal(t, runnerV3, namedRelease(t, r, "owner-a"), "a newer release resumes the roll at the runner that stalled")
		})
	}
}

func backdateHandoff(t *testing.T, r *AgentReconciler, owner string, by time.Duration) {
	t.Helper()
	cms := r.client.CoreV1().ConfigMaps("test-agents")
	cm, err := cms.Get(context.Background(), r.runnerReleaseName(owner), metav1.GetOptions{})
	require.NoError(t, err)
	cm.Annotations[annRunnerHandoffAt] = time.Now().Add(-by).UTC().Format(time.RFC3339)
	_, err = cms.Update(context.Background(), cm, metav1.UpdateOptions{})
	require.NoError(t, err)
}

func namedRelease(t *testing.T, r *AgentReconciler, owner string) string {
	t.Helper()
	cm, err := r.client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), r.runnerReleaseName(owner), metav1.GetOptions{})
	require.NoError(t, err)
	return cm.Data[runnerReleaseKey]
}

// TEST_SCENARIO: a runner release built against another VM runtime cannot adopt the machines, so the pod's loader holds on to the release it runs. The controller reads that hold from the runner and rolls the pod onto the new image, through the same roll as any changed pod. A release that is only not staged yet is waited for instead.
func TestARunnerReleaseTheLoaderCannotTakeRollsThePod(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	r.config.VM.Runner.ReleaseHostPath = "/var/lib/platform-runner-releases"
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
}

// TEST_SCENARIO: a runner that does not answer right after it was named a new release is mid hand-off, and its pod is left alone. One that still does not answer long after has a loader that brings up neither the new release nor the old one, and the pod is rolled onto the configured image, the only way its machines get a working runner again.
func TestARunnerThatStaysUnreachableAfterANewReleaseRollsThePod(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t)
	r.config.VM.Runner.ReleaseHostPath = "/var/lib/platform-runner-releases"
	createRolloutRunner(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, "owner-a")
	r.config.VM.Runner.Image = runnerV2
	r.runnerEndpoint = func(string) string { return "https://127.0.0.1:1" }

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-a"), "a runner mid hand-off is not rolled")

	cms := r.client.CoreV1().ConfigMaps("test-agents")
	cm, err := cms.Get(ctx, r.runnerReleaseName("owner-a"), metav1.GetOptions{})
	require.NoError(t, err)
	cm.Annotations[annRunnerReleaseNamedAt] = time.Now().Add(-runnerReleaseUnreachableRoll - time.Minute).UTC().Format(time.RFC3339)
	_, err = cms.Update(ctx, cm, metav1.UpdateOptions{})
	require.NoError(t, err)
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
	r.config.VM.Runner.ReleaseHostPath = "/var/lib/platform-runner-releases"
	createRolloutRunner(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	settleRunnerPod(t, r, "owner-a")
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	cms := r.client.CoreV1().ConfigMaps("test-agents")
	cm, err := cms.Get(ctx, r.runnerReleaseName("owner-a"), metav1.GetOptions{})
	require.NoError(t, err)
	cm.Annotations[annRunnerReleaseNamedAt] = time.Now().Add(-runnerReleaseUnreachableRoll - time.Minute).UTC().Format(time.RFC3339)
	_, err = cms.Update(ctx, cm, metav1.UpdateOptions{})
	require.NoError(t, err)

	nodes["owner-a"].release = outcome
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a", r.runnerOwnerRef(ctx), true))
	cm, err = cms.Get(ctx, r.runnerReleaseName("owner-a"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotContains(t, cm.Annotations, annRunnerReleaseNamedAt)

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
			r.config.VM.Runner.ReleaseHostPath = "/var/lib/platform-runner-releases"
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

// TEST_SCENARIO: a new runner release reaches an install where most owners have nothing running, so no agent of theirs reconciles. One sweep takes it to each of them in turn, waiting only for each runner to take it, rather than one owner per sweep. An owner with a ready machine still holds the place until its agents settle the hand-off, so the owners after it wait.
func TestOneSweepTakesAReleaseToEveryOwnerWithNothingRunning(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t)
	r.config.VM.Runner.ReleaseHostPath = "/var/lib/platform-runner-releases"
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
