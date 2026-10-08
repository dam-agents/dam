// TEST_OVERVIEW: a runner's machines are its processes, so a change to the runner pod reboots every machine of that owner. The controller must create a new owner's runner at once, leave a runner alone while its rendered pod is unchanged, and roll a changed pod to at most `rollout.maxConcurrent` runners at a time, each holding its place until its new pod is ready and the machines that were ready before are ready again — or until the settle timeout says it never will be.
package reconciler

import (
	"context"
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
	_, _, err := r.ensureRunner(ctx, owner, runnerDemand{})
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
	_, _, err := r.ensureRunner(ctx, "owner-new", runnerDemand{})
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
	assert.Equal(t, "17a6921af08fc832", dep.Annotations[annRunnerTemplate])
}

// TEST_SCENARIO: a runner's pod is unchanged, but its labels were edited by hand and its owner reference points at nothing — the runner ServiceAccount was recreated. Both are restored without touching the pod, so no machine restarts and no roll starts.
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
	pvc.OwnerReferences = nil
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
	require.Len(t, pvc.OwnerReferences, 1)
	assert.Equal(t, types.UID("sa-now"), pvc.OwnerReferences[0].UID)
}

// TEST_SCENARIO: with releases staged on the node, a new runner image is not a changed pod. Every owner's pod keeps its image and every machine on it, and each owner's release ConfigMap names the new image, which the pod's loader takes in place.
func TestANewRunnerImageReachesEveryOwnerWithoutAPodRoll(t *testing.T) {
	ctx := context.Background()
	r, _ := setupRolloutReconciler(t)
	r.config.VM.Runner.ReleaseHostPath = "/var/lib/platform-runner-releases"
	for _, owner := range []string{"owner-a", "owner-b"} {
		createRolloutRunner(t, r, owner)
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
	}
	r.config.VM.Runner.Image = runnerV2

	for _, owner := range []string{"owner-a", "owner-b"} {
		require.NoError(t, r.applyRunnerDeployment(ctx, owner, r.runnerOwnerRef(ctx), true))
		assert.Equal(t, runnerV1, runnerImageOf(t, r, owner), "the pod keeps the image it started with")
		cm, err := r.client.CoreV1().ConfigMaps("test-agents").Get(ctx, r.runnerReleaseName(owner), metav1.GetOptions{})
		require.NoError(t, err)
		assert.Equal(t, runnerV2, cm.Data[runnerReleaseKey])
		require.Len(t, cm.OwnerReferences, 1)
		assert.Equal(t, r.runnerName(owner), cm.OwnerReferences[0].Name)
	}
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
