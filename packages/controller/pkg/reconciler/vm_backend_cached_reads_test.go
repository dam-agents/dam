// TEST_OVERVIEW: a steady reconcile reads its objects from the informer caches, and a read that disagrees with the live object is redone live rather than acted on.
package reconciler

import (
	"context"
	"maps"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	corelisters "k8s.io/client-go/listers/core/v1"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"

	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func TestASteadyVMReconcileReadsItsObjectsFromTheCaches(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	client := r.client.(*fake.Clientset)
	versionWrites(client)
	_, err := client.CoreV1().ServiceAccounts("test-agents").Create(ctx, &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner", Namespace: "test-agents", UID: "runner-sa"},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	require.NoError(t, r.Reconcile(ctx, agent))
	markGatewayReady(t, r)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
	startCaches(t, r)

	reads := map[string]int{}
	require.Eventually(t, func() bool {
		client.ClearActions()
		require.NoError(t, r.Reconcile(ctx, agent))
		clear(reads)
		writes := 0
		for _, a := range client.Actions() {
			switch a.GetVerb() {
			case "get":
				reads["get "+a.GetResource().Resource+" "+a.(k8stesting.GetAction).GetName()]++
			case "list":
				reads["list "+a.GetResource().Resource]++
			default:
				writes++
			}
		}
		return writes == 0
	}, 5*time.Second, 20*time.Millisecond, "the reconciles settle into one that writes nothing")

	assert.Equal(t, metav1.ConditionTrue, readyCondition(t, r, "my-agent").Status)
	assert.Zero(t, reads["get statefulsets "+GatewayName("my-agent")], "the gateway StatefulSet comes from the cache")
	assert.Zero(t, reads["get deployments "+r.runnerName(testOwner)], "the runner Deployment comes from the cache")
	assert.Zero(t, reads["list pods"], "the runner's pods come from the cache")
	assert.Equal(t, 1, reads["get secrets "+r.runnerName(testOwner)], "the runner's token is read once")
	assert.Equal(t, 1, reads["get secrets "+r.runnerTLSName(testOwner)], "the runner's certificate is read once")
}

func TestAResizeFromAStalePodIsRefusedAndRedoneLive(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	client := r.client.(*fake.Clientset)
	versionWrites(client)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	pods := client.CoreV1().Pods("test-agents")
	stale, err := pods.Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	changed := stale.DeepCopy()
	changed.Labels["changed"] = "after the cache read"
	_, err = pods.Update(ctx, changed, metav1.UpdateOptions{})
	require.NoError(t, err)
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	require.NoError(t, indexer.Add(stale))
	r.WithRunnerCaches(staleInformer(&appsv1.Deployment{}), corelisters.NewPodLister(indexer))
	client.ClearActions()

	r.resizeRunnerPod(ctx, testOwner, runnerDemand{memoryMiB: 4096, vCPUs: 4})

	assert.Equal(t, 2, resizeCalls(r), "the resize from the stale pod was refused and sent again")
	pod, err := pods.Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "after the cache read", pod.Labels["changed"], "the change the cache had not seen is kept")
	assert.NotEqual(t, "1Gi", runnerPodRequest(t, r), "and the resize landed on the current pod")
}

func TestAReconcileReadsItsOwnStatefulSetUpdate(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	client := r.client.(*fake.Clientset)
	versionWrites(client)
	require.NoError(t, r.Reconcile(ctx, agent))
	markGatewayReady(t, r)
	ss, err := client.AppsV1().StatefulSets("test-agents").Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	pod, err := client.CoreV1().Pods("test-agents").Get(ctx, GatewayName("my-agent")+"-0", metav1.GetOptions{})
	require.NoError(t, err)
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	require.NoError(t, indexer.Add(pod))
	r.WithPodCache(corelisters.NewPodLister(indexer)).WithStatefulSetCache(staleInformer(&appsv1.StatefulSet{}, ss))
	require.True(t, r.podCurrentAndReady(ctx, GatewayName("my-agent")))

	desired := ss.DeepCopy()
	desired.Spec.Template.Annotations = map[string]string{"changed": "yes"}
	require.NoError(t, r.applyStatefulSet(ctx, desired, true))

	assert.False(t, r.podCurrentAndReady(ctx, GatewayName("my-agent")), "the gateway is rolling to the new template")
}

func TestAPodNewerThanTheCachedStatefulSetIsNotForceRolled(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	client := r.client.(*fake.Clientset)
	require.NoError(t, r.Reconcile(ctx, agent))
	sets := client.AppsV1().StatefulSets("test-agents")
	ss, err := sets.Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	ss.Status.ObservedGeneration, ss.Status.UpdateRevision = ss.Generation, "rev-1"
	cached := ss.DeepCopy()
	ss.Status.UpdateRevision = "rev-2"
	_, err = sets.UpdateStatus(ctx, ss, metav1.UpdateOptions{})
	require.NoError(t, err)
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: GatewayName("my-agent") + "-0", Namespace: "test-agents",
			Labels: maps.Clone(ss.Spec.Selector.MatchLabels)},
	}
	pod.Labels["controller-revision-hash"] = "rev-2"
	_, err = client.CoreV1().Pods("test-agents").Create(ctx, pod, metav1.CreateOptions{})
	require.NoError(t, err)
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	require.NoError(t, indexer.Add(pod))
	r.WithPodCache(corelisters.NewPodLister(indexer)).WithStatefulSetCache(staleInformer(&appsv1.StatefulSet{}, cached))

	require.NoError(t, r.forceRollStuckPod(ctx, "test-agents", GatewayName("my-agent")))

	_, err = client.CoreV1().Pods("test-agents").Get(ctx, pod.Name, metav1.GetOptions{})
	assert.NoError(t, err, "the pod on the current revision is left to start")
}
