// TEST_OVERVIEW: a node drain evicts every runner on the node at once, and each eviction reboots every machine of that owner mid-turn. A runner with a machine to run therefore carries a disruption budget that allows none, and a drain waits — but only for the drain grace after the runner's node became unschedulable, after which the budget goes and the drain proceeds. A runner with nothing to run has no budget.
package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TEST_SCENARIO: every combination the budget depends on. Nothing to run never holds; a schedulable node always holds and forgets any drain it saw; an unschedulable node holds from the moment it is first seen until the grace has passed, and a budget already removed during a drain is not put back.
func TestRunnerDisruptionVerdict(t *testing.T) {
	now := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	grace := 15 * time.Minute
	for _, tc := range []struct {
		name                     string
		running, cordoned, exist bool
		seen                     time.Time
		hold                     bool
		seenAt                   time.Time
	}{
		{name: "nothing to run", running: false, cordoned: true, exist: true, seen: now.Add(-time.Minute)},
		{name: "schedulable node", running: true, exist: true, seen: now.Add(-time.Hour), hold: true},
		{name: "schedulable node, no budget yet", running: true, hold: true},
		{name: "drain first seen", running: true, cordoned: true, exist: true, hold: true, seenAt: now},
		{name: "drain within the grace", running: true, cordoned: true, exist: true, seen: now.Add(-10 * time.Minute), hold: true, seenAt: now.Add(-10 * time.Minute)},
		{name: "drain past the grace", running: true, cordoned: true, exist: true, seen: now.Add(-grace)},
		{name: "budget already removed during the drain", running: true, cordoned: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			hold, seenAt := runnerDisruptionVerdict(tc.running, tc.cordoned, tc.exist, tc.seen, now, grace)
			assert.Equal(t, tc.hold, hold)
			assert.Equal(t, tc.seenAt, seenAt)
		})
	}
}

func setupDisruptionReconciler(t *testing.T) *AgentReconciler {
	t.Helper()
	ctx := context.Background()
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	_, err := r.client.CoreV1().ServiceAccounts("test-agents").Create(ctx, &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner", Namespace: "test-agents", UID: "sa-uid"},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	_, err = r.client.CoreV1().Nodes().Create(ctx, &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "kvm-1"}}, metav1.CreateOptions{})
	require.NoError(t, err)
	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, readyRunnerPod().Name, metav1.GetOptions{})
	require.NoError(t, err)
	pod.Spec.NodeName = "kvm-1"
	_, err = r.client.CoreV1().Pods("test-agents").Update(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	return r
}

func runnerPDB(t *testing.T, r *AgentReconciler) *policyv1.PodDisruptionBudget {
	t.Helper()
	pdb, err := r.client.PolicyV1().PodDisruptionBudgets("test-agents").Get(context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return nil
	}
	require.NoError(t, err)
	return pdb
}

func cordon(t *testing.T, r *AgentReconciler, unschedulable bool) {
	t.Helper()
	ctx := context.Background()
	node, err := r.client.CoreV1().Nodes().Get(ctx, "kvm-1", metav1.GetOptions{})
	require.NoError(t, err)
	node.Spec.Unschedulable = unschedulable
	_, err = r.client.CoreV1().Nodes().Update(ctx, node, metav1.UpdateOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: an agent starting its machine protects its owner's runner on that very reconcile, with a budget that allows no eviction of the runner's pod, owned like the runner's other objects; once no machine of the owner should run, the budget is gone.
func TestARunnerWithRunningMachinesCannotBeEvicted(t *testing.T) {
	ctx := context.Background()
	r := setupDisruptionReconciler(t)

	_, _, err := r.ensureRunner(ctx, testOwner, runnerDemand{machines: 1, running: 1})
	require.NoError(t, err)
	pdb := runnerPDB(t, r)
	require.NotNil(t, pdb, "a running machine protects its runner at once")
	assert.Equal(t, int32(0), pdb.Spec.MaxUnavailable.IntVal)
	assert.Equal(t, vmRunnerSelector(testOwner), pdb.Spec.Selector.MatchLabels)
	require.Len(t, pdb.OwnerReferences, 1)
	assert.Equal(t, "platform-vm-runner", pdb.OwnerReferences[0].Name)

	_, _, err = r.ensureRunner(ctx, testOwner, runnerDemand{machines: 1})
	require.NoError(t, err)
	assert.Nil(t, runnerPDB(t, r), "a runner with nothing to run is free to move")
}

// TEST_SCENARIO: a drain delays a runner but never blocks it for good. The budget holds while the node has been unschedulable for less than the grace, keeping the moment the drain was first seen, is removed once the grace has passed, and stays removed while the node is still draining; when the runner is on a schedulable node again its budget comes back.
func TestADrainIsHeldOffOnlyForTheDrainGrace(t *testing.T) {
	ctx := context.Background()
	r := setupDisruptionReconciler(t)
	r.vmRunning.Store("my-agent", true)

	r.ReconcileRunnerHealth(ctx)
	require.NotNil(t, runnerPDB(t, r))

	cordon(t, r, true)
	r.ReconcileRunnerHealth(ctx)
	pdb := runnerPDB(t, r)
	require.NotNil(t, pdb, "the drain is held off within the grace")
	seen, err := time.Parse(time.RFC3339, pdb.Annotations[annRunnerDrainSeen])
	require.NoError(t, err)
	assert.WithinDuration(t, time.Now(), seen, time.Minute)
	assert.Equal(t, int64(1), r.RunnerHealth().DrainsHeld)

	pdb.Annotations[annRunnerDrainSeen] = time.Now().Add(-defaultRunnerDrainGrace - time.Minute).UTC().Format(time.RFC3339)
	_, err = r.client.PolicyV1().PodDisruptionBudgets("test-agents").Update(ctx, pdb, metav1.UpdateOptions{})
	require.NoError(t, err)
	r.ReconcileRunnerHealth(ctx)
	assert.Nil(t, runnerPDB(t, r), "past the grace the drain may evict the runner")
	assert.Equal(t, int64(0), r.RunnerHealth().DrainsHeld)

	r.ReconcileRunnerHealth(ctx)
	assert.Nil(t, runnerPDB(t, r), "a budget put back while the node drains would hold it off for another grace")

	cordon(t, r, false)
	r.ReconcileRunnerHealth(ctx)
	pdb = runnerPDB(t, r)
	require.NotNil(t, pdb)
	assert.Empty(t, pdb.Annotations[annRunnerDrainSeen])
}

// TEST_SCENARIO: the drain grace comes from the install. A shorter one lifts the budget sooner than the default would.
func TestTheDrainGraceIsTheInstalls(t *testing.T) {
	ctx := context.Background()
	r := setupDisruptionReconciler(t)
	r.config.VM.Runner.Disruption.DrainGrace = 0
	assert.Equal(t, defaultRunnerDrainGrace, runnerDrainGrace(r.config.VM.Runner))
	r.config.VM.Runner.Disruption.DrainGrace = 1
	r.vmRunning.Store("my-agent", true)
	cordon(t, r, true)

	_, err := r.syncRunnerDisruption(ctx, testOwner, true, nil, nil)
	require.NoError(t, err)
	require.Nil(t, runnerPDB(t, r), "a node that is already draining gets no budget")

	cordon(t, r, false)
	_, err = r.syncRunnerDisruption(ctx, testOwner, true, nil, nil)
	require.NoError(t, err)
	cordon(t, r, true)
	_, err = r.syncRunnerDisruption(ctx, testOwner, true, nil, nil)
	require.NoError(t, err)
	require.NotNil(t, runnerPDB(t, r))
	_, err = r.syncRunnerDisruption(ctx, testOwner, true, nil, nil)
	require.NoError(t, err)
	assert.Nil(t, runnerPDB(t, r))
}

// TEST_SCENARIO: removing a runner takes its budget with everything else it owns.
func TestRemovingARunnerRemovesItsBudget(t *testing.T) {
	ctx := context.Background()
	r := setupDisruptionReconciler(t)
	_, err := r.syncRunnerDisruption(ctx, testOwner, true, nil, nil)
	require.NoError(t, err)
	require.NotNil(t, runnerPDB(t, r))

	require.True(t, r.deleteRunner(ctx, testOwner))
	assert.Nil(t, runnerPDB(t, r))
}
