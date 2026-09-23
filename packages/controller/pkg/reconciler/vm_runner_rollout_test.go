// TEST_OVERVIEW: a runner's machines are its processes, so a change to the runner pod reboots every machine of that owner. The controller must create a new owner's runner at once, leave a runner alone while its rendered pod is unchanged, and roll a changed pod to at most `rollout.maxConcurrent` runners at a time, each holding its place until its new pod is ready and the machines that were ready before are ready again — or until the settle timeout says it never will be. A canary image reaches only the owners the install names or whose stable bucket falls under the canary percentage.
package reconciler

import (
	"context"
	"fmt"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	"k8s.io/apimachinery/pkg/api/equality"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func setupRolloutReconciler(t *testing.T, owners ...string) (*AgentReconciler, map[string]*fakeNode) {
	t.Helper()
	r, _, _ := setupVMReconciler(t, vmAgentCR())
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
	r.runnerRollGate.recheck = time.Nanosecond
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

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a"))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b"))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-a"))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "only one runner is mid-roll at a time")

	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped})
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b"))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "the first runner's new pod is not ready yet")

	settleRunnerPod(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b"))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"), "the pod is ready but the machine it had is not back")

	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b"))
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
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a"))

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

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a"))
	for _, a := range cs.Actions() {
		assert.False(t, a.GetVerb() == "update" && a.GetResource().Resource == "deployments", "unexpected %s of %s", a.GetVerb(), a.GetResource().Resource)
	}
}

// TEST_SCENARIO: a machine that was ready before the roll never comes back — its agent was hibernated mid-roll, say. The runner stops holding its place once the settle timeout has passed, so one owner cannot stall every other owner's upgrade.
func TestARollThatNeverSettlesStopsHoldingItsPlace(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	nodes["owner-a"].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a"))
	settleRunnerPod(t, r, "owner-a")
	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped})

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b"))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"))

	setRolledAt(t, r, "owner-a", time.Now().Add(-defaultRunnerSettleTimeout-time.Minute))
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b"))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"))
}

// TEST_SCENARIO: a machine that was ready before the roll belongs to an agent deleted during it. It will never be ready again, and there is nothing left to wait for.
func TestAMachineWhoseAgentIsGoneDoesNotHoldTheRoll(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	nodes["owner-a"].specs["deleted-agent"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("deleted-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a"))
	settleRunnerPod(t, r, "owner-a")
	nodes["owner-a"].set("deleted-agent", vmrunner.MachineStatus{State: vmrunner.StateAbsent})

	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b"))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"))
}

// TEST_SCENARIO: an install with many owners raises the roll's width. That many runners roll together, and the next one still waits.
func TestTheRollWidthIsTheInstalls(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t, "owner-a", "owner-b", "owner-c")
	r.config.VM.Runner.Rollout.MaxConcurrent = 2
	r.config.VM.Runner.Image = runnerV2

	for _, owner := range []string{"owner-a", "owner-b", "owner-c"} {
		require.NoError(t, r.applyRunnerDeployment(ctx, owner))
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

// TEST_SCENARIO: an install trials a new runner build on a few owners first. Named owners and owners in the canary percentage get the canary image, and everyone else keeps the install's image.
func TestACanaryImageReachesOnlyTheCanaryOwners(t *testing.T) {
	r, _ := setupRolloutReconciler(t)
	r.config.VM.Runner.CanaryImage = runnerV2
	r.config.VM.Runner.Canary = config.VMRunnerCanary{Owners: []string{"owner-canary"}}

	for _, owner := range []string{"owner-canary", "owner-plain"} {
		createRolloutRunner(t, r, owner)
	}
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-canary"))
	assert.Equal(t, runnerV1, runnerImageOf(t, r, "owner-plain"))

	r.config.VM.Runner.CanaryImage = ""
	assert.Equal(t, runnerV1, runnerImage(r.config.VM.Runner, "owner-canary"), "no canary image means no canary, whoever is named")
}

// TEST_SCENARIO: the canary percentage picks owners by a hash of the owner label alone. The same owner is picked every time, raising the percentage only adds owners, and the share picked is close to what was asked.
func TestTheCanaryPercentageIsStable(t *testing.T) {
	picked := func(percent int) map[string]bool {
		out := map[string]bool{}
		for i := range 1000 {
			owner := fmt.Sprintf("user-%d", i)
			if isCanaryOwner(owner, config.VMRunnerCanary{Percent: percent}) {
				out[owner] = true
			}
		}
		return out
	}
	assert.Empty(t, picked(0))
	assert.Len(t, picked(100), 1000)
	ten, twenty := picked(10), picked(20)
	assert.Equal(t, ten, picked(10), "the same owners every time")
	for owner := range ten {
		assert.True(t, twenty[owner], "%s was a canary at 10%% and must stay one at 20%%", owner)
	}
	assert.InDelta(t, 100, len(ten), 40)
}

// TEST_SCENARIO: an owner waits their turn while one of their machines is starting, so their agent reconciles every half second. The gate keeps its last "the roll is full" answer for a short while, so those passes do not list every runner, which is what the rest of the settle check — calls to the rolling owner's runner about each of its machines — hangs off.
func TestAWaitingRunnerDoesNotAskAboutTheRollOnEveryPass(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, "owner-a", "owner-b")
	r.runnerRollGate.recheck = time.Hour
	nodes["owner-a"].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes["owner-a"].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	r.config.VM.Runner.Image = runnerV2
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-a"))
	settleRunnerPod(t, r, "owner-a")
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b"))
	require.Equal(t, runnerV1, runnerImageOf(t, r, "owner-b"))

	cs := r.client.(*fake.Clientset)
	cs.ClearActions()
	for range 5 {
		require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b"))
	}
	for _, a := range cs.Actions() {
		assert.False(t, a.GetVerb() == "list" && a.GetResource().Resource == "deployments", "a waiting pass must not list every runner")
		assert.False(t, a.GetVerb() == "get" && a.GetResource().Resource == "agents", "nor look up the rolling owner's agents")
	}

	r.runnerRollGate.recheck = time.Nanosecond
	require.NoError(t, r.applyRunnerDeployment(ctx, "owner-b"))
	assert.Equal(t, runnerV2, runnerImageOf(t, r, "owner-b"), "once the answer is stale the gate asks again and finds the first roll settled")
}
