// TEST_OVERVIEW: the leader's pool pass tells operators how much the users' VM pools promise against what the cluster holds, how many users' pools sit at each level, and which runner pods the node will not resize — without naming a user in any figure. A user whose pool goes critical, or whose runner the node cannot fit, is named only by Warning Events on their vm Agents, and the second also by a condition on them that leaves readiness alone.
package reconciler

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

func poolPassReconciler(t *testing.T) (*AgentReconciler, *fakeNode, *apiv1.Agent) {
	t.Helper()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	u, err := agentToUnstructured(agent)
	require.NoError(t, err)
	require.NoError(t, indexer.Add(u))
	r.WithAgentCache(cache.NewGenericLister(indexer, AgentsGVR.GroupResource()))

	ctx := context.Background()
	pods := r.client.CoreV1().Pods("test-agents")
	pod, err := pods.Get(ctx, readyRunnerPod().Name, metav1.GetOptions{})
	require.NoError(t, err)
	pod.Spec.Containers = []corev1.Container{{Name: vmRunnerComponent, Resources: corev1.ResourceRequirements{
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("12Gi"), corev1.ResourceCPU: resource.MustParse("9")},
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("4Gi")},
	}}}
	_, err = pods.Update(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)

	class := "ceph-rbd"
	_, err = r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{Name: r.runnerName(testOwner), Namespace: "test-agents", Labels: vmRunnerSelector(testOwner)},
		Spec: corev1.PersistentVolumeClaimSpec{StorageClassName: &class, Resources: corev1.VolumeResourceRequirements{
			Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("100Gi")},
		}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	_, err = r.client.CoreV1().Nodes().Create(ctx, &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "kvm-1"},
		Status: corev1.NodeStatus{Allocatable: corev1.ResourceList{
			corev1.ResourceMemory: resource.MustParse("64Gi"), corev1.ResourceCPU: resource.MustParse("16"),
		}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	return r, node, agent
}

func resizePendingOn(t *testing.T, r *AgentReconciler, reason string) {
	t.Helper()
	pods := r.client.CoreV1().Pods("test-agents")
	pod, err := pods.Get(context.Background(), readyRunnerPod().Name, metav1.GetOptions{})
	require.NoError(t, err)
	pod.Status.Conditions = []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}
	if reason != "" {
		pod.Status.Conditions = append(pod.Status.Conditions, corev1.PodCondition{
			Type: corev1.PodResizePending, Status: corev1.ConditionTrue, Reason: reason, Message: "Node didn't have enough capacity",
		})
	}
	_, err = pods.UpdateStatus(context.Background(), pod, metav1.UpdateOptions{})
	require.NoError(t, err)
}

func eventsWithReason(t *testing.T, r *AgentReconciler, reason string) int {
	t.Helper()
	events, err := r.client.CoreV1().Events("test-agents").List(context.Background(), metav1.ListOptions{})
	require.NoError(t, err)
	n := 0
	for _, e := range events.Items {
		if e.Reason == reason {
			n++
		}
	}
	return n
}

// TEST_SCENARIO: committed is what the runners' limits and claims promise, reserved what their requests hold, capacity what the nodes hold; storage capacity is absent until the claims' storage driver publishes one, and then it is that. Each user's runner counts once per resource at the level its own usage read gives.
func TestThePoolPassSumsWhatThePoolsPromiseAgainstTheCluster(t *testing.T) {
	r, node, _ := poolPassReconciler(t)
	node.usage.Memory.LimitMiB, node.usage.Memory.CommittedMiB = 12288, 3072
	node.usage.Storage.UsableBytes, node.usage.Storage.UsedBytes = 100, 80

	pool, _, _, _, ok := r.vmPool(context.Background())
	require.True(t, ok)
	assert.Equal(t, int64(12<<30), pool.Committed["memory"])
	assert.Equal(t, int64(9000), pool.Committed["cpu"])
	assert.Equal(t, int64(100<<30), pool.Committed["storage"])
	assert.Equal(t, int64(4<<30), pool.Reserved["memory"])
	assert.Equal(t, int64(64<<30), pool.Capacity["memory"])
	assert.Equal(t, int64(16000), pool.Capacity["cpu"])
	_, has := pool.Capacity["storage"]
	assert.False(t, has, "no driver publishes the claims' storage capacity")
	assert.Equal(t, int64(1), pool.Runners[[2]string{"memory", "ok"}])
	assert.Equal(t, int64(1), pool.Runners[[2]string{"storage", "warning"}])

	_, err := r.client.StorageV1().CSIStorageCapacities("kube-system").Create(context.Background(), &storagev1.CSIStorageCapacity{
		ObjectMeta:       metav1.ObjectMeta{Name: "ceph", Namespace: "kube-system"},
		StorageClassName: "ceph-rbd",
		Capacity:         resource.NewQuantity(1<<40, resource.BinarySI),
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	pool, _, _, _, _ = r.vmPool(context.Background())
	assert.Equal(t, int64(1<<40), pool.Capacity["storage"])
}

// TEST_SCENARIO: a pool that becomes critical names its user once, by a Warning Event on each of their vm Agents; a pool that stays critical across passes does not repeat it, and one that leaves and comes back does.
func TestACriticalPoolNamesItsUserOncePerCrossing(t *testing.T) {
	r, node, _ := poolPassReconciler(t)
	node.usage.Storage.UsableBytes, node.usage.Storage.UsedBytes = 100, 95
	r.PoolPass(context.Background())
	r.PoolPass(context.Background())
	assert.Equal(t, 1, eventsWithReason(t, r, "VMPoolCritical"))

	node.usage.Storage.UsedBytes = 50
	r.PoolPass(context.Background())
	node.usage.Storage.UsedBytes = 92
	r.PoolPass(context.Background())
	assert.Equal(t, 2, eventsWithReason(t, r, "VMPoolCritical"))
}

// TEST_SCENARIO: the node holding an owner's runner is not ready. Every machine of that owner is gone with it, and no replacement can take the claim while the node keeps it, so the pool pass counts the pods there once and names the owner once by a Warning Event on their vm Agents — a node that stays lost is not announced on every pass. The controller never deletes the pod: two VMMs on one claim cannot be recovered, so an operator fences the node and clears it out of service.
func TestARunnerOnALostNodeIsCountedAndNamesItsUserOnce(t *testing.T) {
	r, _, _ := poolPassReconciler(t)
	runnerPodOnANotReadyNode(t, r)
	ctx := context.Background()

	pool, _, _, _, ok := r.vmPool(ctx)
	require.True(t, ok)
	assert.Equal(t, int64(1), pool.NodeLost)

	r.PoolPass(ctx)
	assert.Equal(t, 1, eventsWithReason(t, r, apiv1.ReasonMachineRunnerNodeLost))
	r.PoolPass(ctx)
	assert.Equal(t, 1, eventsWithReason(t, r, apiv1.ReasonMachineRunnerNodeLost), "a node that stays lost is not announced again")
}

// TEST_SCENARIO: the node list itself fails on a later pass. That says nothing about any node, so the pass publishes nothing: the count the alert is timed on stands, the owner is not announced again, and the loss is not announced a second time once the read returns.
func TestAPassThatCannotReadTheNodesKeepsTheLastOne(t *testing.T) {
	r, _, _ := poolPassReconciler(t)
	runnerPodOnANotReadyNode(t, r)
	ctx := context.Background()
	r.PoolPass(ctx)
	require.Equal(t, 1, eventsWithReason(t, r, apiv1.ReasonMachineRunnerNodeLost))

	unreadable := true
	r.client.(*fake.Clientset).PrependReactor("list", "nodes", func(k8stesting.Action) (bool, runtime.Object, error) {
		if !unreadable {
			return false, nil, nil
		}
		return true, nil, errors.New("the node list is unavailable")
	})

	_, _, _, _, ok := r.vmPool(ctx)
	assert.False(t, ok, "a pass that cannot read the nodes publishes nothing")
	r.PoolPass(ctx)
	assert.Equal(t, 1, eventsWithReason(t, r, apiv1.ReasonMachineRunnerNodeLost), "an unreadable node list announced the loss again")
	_, kept := r.nodeLostNotices.Load(testOwner)
	assert.True(t, kept, "the lost node was forgotten while the nodes could not be read")

	unreadable = false
	r.PoolPass(ctx)
	assert.Equal(t, 1, eventsWithReason(t, r, apiv1.ReasonMachineRunnerNodeLost), "the same loss was announced again once the nodes were readable")
}

// UNIT_BOUNDARY_DESCRIPTION: the owner's ready runner pod, moved onto a node the cluster reports not ready — one of the two pods a lost node leaves behind.
func runnerPodOnANotReadyNode(t *testing.T, r *AgentReconciler) {
	t.Helper()
	ctx := context.Background()
	pods := r.client.CoreV1().Pods("test-agents")
	pod, err := pods.Get(ctx, readyRunnerPod().Name, metav1.GetOptions{})
	require.NoError(t, err)
	pod.Spec.NodeName = "kvm-2"
	_, err = pods.Update(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	_, err = r.client.CoreV1().Nodes().Create(ctx, &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "kvm-2"},
		Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{
			Type: corev1.NodeReady, Status: corev1.ConditionFalse}}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: a controller that restarts while a pool stays critical does not name its user again, since the Event it wrote before the restart is still there; a pool critical for another resource still is.
func TestARestartDoesNotRepeatACriticalPoolsEvent(t *testing.T) {
	r, node, _ := poolPassReconciler(t)
	node.usage.Storage.UsableBytes, node.usage.Storage.UsedBytes = 100, 95
	r.PoolPass(context.Background())
	require.Equal(t, 1, eventsWithReason(t, r, "VMPoolCritical"))

	r.poolLevels.Range(func(key, _ any) bool { r.poolLevels.Delete(key); return true })
	r.PoolPass(context.Background())
	assert.Equal(t, 1, eventsWithReason(t, r, "VMPoolCritical"), "the restart repeated the storage pool's event")

	r.poolLevels.Range(func(key, _ any) bool { r.poolLevels.Delete(key); return true })
	node.usage.Memory.LimitMiB, node.usage.Memory.CommittedMiB = 1000, 950
	r.PoolPass(context.Background())
	assert.Equal(t, 2, eventsWithReason(t, r, "VMPoolCritical"), "the memory pool's first crossing was not announced")
}

// TEST_SCENARIO: the earlier announcement counts wherever it landed among the user's agents, not only on the first one the cache lists; another user's Event, or one for another resource, does not count.
func TestAnEarlierCriticalEventCountsOnAnyOfTheUsersAgents(t *testing.T) {
	r, _, first := poolPassReconciler(t)
	second := first.DeepCopy()
	second.Name = "second-agent"
	r.agentEvent(context.Background(), second, corev1.EventTypeWarning, "VMPoolCritical", "this user's VM storage pool is 95% full")

	assert.True(t, r.poolCriticalAnnounced(context.Background(), []*apiv1.Agent{first, second}, "storage"))
	assert.False(t, r.poolCriticalAnnounced(context.Background(), []*apiv1.Agent{first}, "storage"), "another agent's event counted for a user who does not own it")
	assert.False(t, r.poolCriticalAnnounced(context.Background(), []*apiv1.Agent{first, second}, "memory"), "the storage event counted for memory")
}

// TEST_SCENARIO: a resize the node refuses puts a RunnerCapacity condition and one Warning Event on each of the user's vm Agents, and hands them back to be reconciled; readiness is not the condition's to change. It stays quiet while the state holds, and once the node applies the resize the condition goes and the agents are handed back again.
func TestARefusedResizeIsAConditionAndAnEventOnTheUsersAgents(t *testing.T) {
	r, _, agent := poolPassReconciler(t)
	resizePendingOn(t, r, corev1.PodReasonInfeasible)
	assert.Equal(t, []string{agent.Name}, r.PoolPass(context.Background()))
	assert.Equal(t, 1, eventsWithReason(t, r, apiv1.ReasonRunnerResizeInfeasible))

	var status apiv1.AgentStatus
	r.runnerCapacityCondition(&status, agent)
	c := apimeta.FindStatusCondition(status.Conditions, apiv1.ConditionRunnerCapacity)
	require.NotNil(t, c)
	assert.Equal(t, metav1.ConditionFalse, c.Status)
	assert.Equal(t, apiv1.ReasonRunnerResizeInfeasible, c.Reason)
	assert.Contains(t, c.Message, "Node didn't have enough capacity")
	assert.Nil(t, apimeta.FindStatusCondition(status.Conditions, apiv1.ConditionAgentPodReady))

	assert.Empty(t, r.PoolPass(context.Background()))
	assert.Equal(t, 1, eventsWithReason(t, r, apiv1.ReasonRunnerResizeInfeasible))

	resizePendingOn(t, r, "")
	assert.Equal(t, []string{agent.Name}, r.PoolPass(context.Background()))
	r.runnerCapacityCondition(&status, agent)
	assert.Nil(t, apimeta.FindStatusCondition(status.Conditions, apiv1.ConditionRunnerCapacity))
}

// TEST_SCENARIO: the levels are the epic's: warning from 75% and critical from 90% of the pool, and a pool with no limit is never full.
func TestAPoolLevelIsWarningFromSeventyFiveAndCriticalFromNinety(t *testing.T) {
	assert.Equal(t, "ok", poolLevel(74, 100))
	assert.Equal(t, "warning", poolLevel(75, 100))
	assert.Equal(t, "critical", poolLevel(90, 100))
	assert.Equal(t, "ok", poolLevel(5, 0))
}
