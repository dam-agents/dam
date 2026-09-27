// TEST_OVERVIEW: the orphan sweep removes an owner's runner — its Deployment and its one claim, which holds every machine disk of that owner — once the owner has no vm agent and the runner holds no machine. An agent's reconcile builds the same runner from the same objects at the same time, so the two must never interleave: the sweep decides and deletes under the owner's lock, a reconcile that meets a runner still being removed waits instead of adopting a claim that is going away, a Deployment that changed since the sweep looked is kept, and neither the rollout sweep nor an unreachable runner can bring one back or keep one forever.
package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func runnerClaimExists(t *testing.T, r *AgentReconciler, owner string) bool {
	t.Helper()
	_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), r.runnerName(owner), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return false
	}
	require.NoError(t, err)
	return true
}

func runnerDeploymentExists(t *testing.T, r *AgentReconciler, owner string) bool {
	t.Helper()
	_, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(owner), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return false
	}
	require.NoError(t, err)
	return true
}

// UNIT_BOUNDARY_DESCRIPTION: turns the owner's only Agent into a container agent, so its runner serves no vm agent and holds no machine: exactly what the sweep collects.
func leaveRunnerUnused(t *testing.T, r *AgentReconciler, node *fakeNode) {
	t.Helper()
	ctx := context.Background()
	stored, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	unstructured.RemoveNestedField(stored.Object, "spec", "backend")
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, stored, metav1.UpdateOptions{})
	require.NoError(t, err)
	node.mu.Lock()
	node.specs = map[string]vmrunner.MachineSpec{}
	node.mu.Unlock()
}

func agentPodReadyMessage(t *testing.T, r *AgentReconciler, name string) (string, string) {
	t.Helper()
	obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	a, err := FromCacheObject[apiv1.Agent](obj)
	require.NoError(t, err)
	for _, c := range a.Status.Conditions {
		if c.Type == apiv1.ConditionAgentPodReady {
			return c.Reason, c.Message
		}
	}
	return "", ""
}

// TEST_SCENARIO: the sweep is about to collect an unused runner while an agent's reconcile is mid-way through building it, holding the owner's lock. The sweep waits for the lock; by then the reconcile has made the owner a vm agent with a machine, and the sweep's reads — all taken under the lock — keep the runner and its claim.
func TestTheSweepWaitsForAReconcileHoldingTheOwnersLock(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	leaveRunnerUnused(t, r, node)

	lock := r.ownerLock(testOwner)
	lock.Lock()
	done := make(chan struct{})
	go func() {
		r.ReconcileOrphanMachines(ctx)
		close(done)
	}()
	select {
	case <-done:
		t.Fatal("the sweep went ahead while a reconcile held the owner's lock")
	case <-time.After(50 * time.Millisecond):
	}
	u, err := agentToUnstructured(agent)
	require.NoError(t, err)
	stored, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	u.SetResourceVersion(stored.GetResourceVersion())
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, u, metav1.UpdateOptions{})
	require.NoError(t, err)
	node.mu.Lock()
	node.specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	node.mu.Unlock()
	lock.Unlock()
	<-done

	assert.True(t, runnerDeploymentExists(t, r, testOwner))
	assert.True(t, runnerClaimExists(t, r, testOwner), "the claim holding the new machine's disk is kept")
}

// TEST_SCENARIO: the sweep's fresh List of the owner's Agents is one opinion; the informer cache is a second, and an Agent either one knows of keeps the runner. Here the Agent becomes a vm agent after the List and before the cache is read.
func TestTheSweepRechecksTheCacheAfterItsList(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	leaveRunnerUnused(t, r, node)

	dyn := r.dynamic.(interface {
		PrependReactor(verb, resource string, reaction k8stesting.ReactionFunc)
		Tracker() k8stesting.ObjectTracker
	})
	lists := 0
	dyn.PrependReactor("list", "agents", func(k8stesting.Action) (bool, runtime.Object, error) {
		lists++
		if lists == 2 {
			stored, err := dyn.Tracker().Get(AgentsGVR, "test-agents", "my-agent")
			require.NoError(t, err)
			u := stored.(*unstructured.Unstructured).DeepCopy()
			require.NoError(t, unstructured.SetNestedField(u.Object, "vm", "spec", "backend", "type"))
			require.NoError(t, dyn.Tracker().Update(AgentsGVR, u, "test-agents"))
		}
		return false, nil, nil
	})

	r.ReconcileOrphanMachines(ctx)

	assert.GreaterOrEqual(t, lists, 2, "the cache was consulted after the List")
	assert.True(t, runnerClaimExists(t, r, testOwner))
}

// TEST_SCENARIO: the sweep found the runner unused, but its Deployment changed before the delete landed — a roll, or a reconcile that just grew it. The delete names the UID and resourceVersion it checked, the API server refuses it, and the sweep stops there: the claim and the credentials stay for the next sweep to look at again.
func TestTheSweepKeepsARunnerWhoseDeploymentChangedUnderIt(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	leaveRunnerUnused(t, r, node)

	cs := r.client.(*fake.Clientset)
	var guarded *metav1.Preconditions
	cs.PrependReactor("delete", "deployments", func(action k8stesting.Action) (bool, runtime.Object, error) {
		guarded = action.(k8stesting.DeleteAction).GetDeleteOptions().Preconditions
		return true, nil, k8serrors.NewConflict(schema.GroupResource{Group: "apps", Resource: "deployments"}, r.runnerName(testOwner), nil)
	})

	r.ReconcileOrphanMachines(ctx)

	require.NotNil(t, guarded, "the delete is conditional on what the sweep checked")
	assert.NotNil(t, guarded.UID)
	assert.NotNil(t, guarded.ResourceVersion)
	assert.True(t, runnerClaimExists(t, r, testOwner), "a refused Deployment delete leaves the claim alone")
	_, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	assert.NoError(t, err, "and the runner's token")
}

// TEST_SCENARIO: an unused runner with nothing changing under it is still collected, whole.
func TestTheSweepRemovesAnUnusedRunner(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	leaveRunnerUnused(t, r, node)

	r.ReconcileOrphanMachines(ctx)

	assert.False(t, runnerDeploymentExists(t, r, testOwner))
	assert.False(t, runnerClaimExists(t, r, testOwner))
}

// TEST_SCENARIO: the sweep has just removed the runner and its claim is still terminating — its pod holds it until it exits. A reconcile of a new vm agent of that owner must not build a runner on that claim, whose disks go with it; it reports that it is waiting, ensures no machine, and asks to be looked at again soon.
func TestAReconcileWaitsForARunnerStillBeingRemoved(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, requeued := setupVMReconciler(t, agent)
	now := metav1.Now()
	_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name: r.runnerName(testOwner), Namespace: "test-agents",
			DeletionTimestamp: &now, Finalizers: []string{"kubernetes.io/pvc-protection"},
		},
		Spec: corev1.PersistentVolumeClaimSpec{Resources: corev1.VolumeResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("10Gi")}}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.client.AppsV1().Deployments("test-agents").Delete(ctx, r.runnerName(testOwner), metav1.DeleteOptions{}))

	require.NoError(t, r.Reconcile(ctx, agent))

	assert.False(t, runnerDeploymentExists(t, r, testOwner), "no runner is built on a claim that is going away")
	assert.Empty(t, node.puts, "no machine is ensured")
	_, msg := agentPodReadyMessage(t, r, "my-agent")
	assert.Contains(t, msg, "still being removed")
	assert.Equal(t, vmReadinessPoll, requeued.last())
}

// TEST_SCENARIO: the rollout sweep listed a runner just before the orphan sweep removed it. Its turn must update a runner that exists and never create one, or a runner nobody uses comes back, claim and all.
func TestTheRolloutSweepDoesNotBringBackARemovedRunner(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	stale := readyRunnerDeployment()
	require.NoError(t, r.client.AppsV1().Deployments("test-agents").Delete(ctx, stale.Name, metav1.DeleteOptions{}))
	cs := r.client.(*fake.Clientset)
	cs.PrependReactor("list", "deployments", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, &appsv1.DeploymentList{Items: []appsv1.Deployment{*stale}}, nil
	})
	cs.ClearActions()

	r.ReconcileRunnerRollout(ctx)

	for _, action := range cs.Actions() {
		assert.False(t, action.GetVerb() == "create" && action.GetResource().Resource == "deployments", "the rollout sweep created a runner")
	}
}

// TEST_SCENARIO: a runner nobody can reach — its TLS Secret is gone — whose owner has no Agent of any kind. It is kept through the grace, since only an agent's reconcile creates a runner and one may be on its way, and removed after it even though nobody could ask it what it holds.
func TestAnUnreachableRunnerOfNoAgentIsRemovedAfterTheGrace(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	require.NoError(t, r.client.CoreV1().Secrets("test-agents").Delete(ctx, r.runnerTLSName(testOwner), metav1.DeleteOptions{}))
	r.runnerEndpoint = nil

	r.ReconcileOrphanMachines(ctx)
	assert.True(t, runnerClaimExists(t, r, testOwner), "an owner with an Agent keeps an unreachable runner")

	require.NoError(t, r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Delete(ctx, "my-agent", metav1.DeleteOptions{}))
	r.ReconcileOrphanMachines(ctx)
	assert.True(t, runnerClaimExists(t, r, testOwner), "the runner is kept through the grace")

	r.ownerless.Store(testOwner, time.Now().Add(-orphanRunnerGrace-time.Minute))
	r.ReconcileOrphanMachines(ctx)
	assert.False(t, runnerDeploymentExists(t, r, testOwner))
	assert.False(t, runnerClaimExists(t, r, testOwner))
}
