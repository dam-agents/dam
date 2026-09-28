// TEST_OVERVIEW: a runner is sized from what its owner's vm agents ask of it. Its pod's memory request follows the memory of the machines that should be running plus the runner's reserve, between the install's request and the limit, and is changed in place on the running pod — never on the Deployment, which would restart every machine — or left alone, with one warning, on a cluster that cannot resize pods. Its claim is sized from the owner's machine disks, the headroom beside each, and the image cache when it lives on the claim; it grows as agents are added, never shrinks, and is created at `runner.storage` — the ceiling — wherever it could not grow later.
package reconciler

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

func runnerPod(t *testing.T, r *AgentReconciler, request, limit string) {
	t.Helper()
	res := corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse(limit)}}
	if request != "" {
		res.Requests = corev1.ResourceList{corev1.ResourceMemory: resource.MustParse(request)}
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: r.runnerName(testOwner) + "-abc", Namespace: "test-agents", Labels: vmRunnerSelector(testOwner)},
		Spec:       corev1.PodSpec{NodeName: "kvm-1", Containers: []corev1.Container{{Name: vmRunnerComponent, Resources: res}}},
	}
	_, err := r.client.CoreV1().Pods("test-agents").Create(context.Background(), pod, metav1.CreateOptions{})
	require.NoError(t, err)
}

func runnerPodRequest(t *testing.T, r *AgentReconciler) string {
	t.Helper()
	pod, err := r.client.CoreV1().Pods("test-agents").Get(context.Background(), r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	q := pod.Spec.Containers[0].Resources.Requests[corev1.ResourceMemory]
	return q.String()
}

func clusterResizesPods(r *AgentReconciler, yes bool) {
	resources := []metav1.APIResource{{Name: "pods"}, {Name: "pods/status"}}
	if yes {
		resources = append(resources, metav1.APIResource{Name: "pods/resize"})
	}
	r.client.(*fake.Clientset).Discovery().(*fakediscovery.FakeDiscovery).Resources = []*metav1.APIResourceList{{
		GroupVersion: "v1", APIResources: resources,
	}}
}

func resizeCalls(r *AgentReconciler) int {
	n := 0
	for _, a := range r.client.(*fake.Clientset).Actions() {
		if a.GetVerb() == "update" && a.GetResource().Resource == "pods" && a.GetSubresource() == "resize" {
			n++
		}
	}
	return n
}

func expandableDefaultClass(t *testing.T, r *AgentReconciler, expands bool) {
	t.Helper()
	sc := &storagev1.StorageClass{
		ObjectMeta:           metav1.ObjectMeta{Name: "standard", Annotations: map[string]string{"storageclass.kubernetes.io/is-default-class": "true"}},
		Provisioner:          "example.com/block",
		AllowVolumeExpansion: new(expands),
	}
	_, err := r.client.StorageV1().StorageClasses().Create(context.Background(), sc, metav1.CreateOptions{})
	require.NoError(t, err)
}

func peerVMAgent(t *testing.T, r *AgentReconciler, name, memory, storage string, up bool) {
	t.Helper()
	ctx := context.Background()
	peer := vmAgentCR()
	peer.Name = name
	peer.Labels = map[string]string{envoyOwnerLabel: testOwner}
	peer.Spec.Resources.Limits["memory"] = memory
	peer.Spec.StorageSize = storage
	u, err := agentToUnstructured(peer)
	require.NoError(t, err)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, u, metav1.CreateOptions{})
	require.NoError(t, err)
	replicas := int32(0)
	if up {
		replicas = 1
	}
	_, err = r.client.AppsV1().StatefulSets("test-agents").Create(ctx, &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: GatewayName(name), Namespace: "test-agents"},
		Spec:       appsv1.StatefulSetSpec{Replicas: &replicas},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
}

func runnerClaim(t *testing.T, r *AgentReconciler) string {
	t.Helper()
	pvc, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	return pvc.Spec.Resources.Requests.Storage().String()
}

// TEST_SCENARIO: the runner admits machines against its memory limit while the scheduler sees only the request. A machine that wakes must raise the request before the runner admits it, by the machine's memory on top of the runner's reserve, and a stop must hand that memory back — so a busy node does not OOM-kill the runner and every machine of this owner with it.
func TestTheRunnerRequestFollowsTheMachinesThatShouldRun(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	ctx := context.Background()

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, "3584Mi", runnerPodRequest(t, r), "the running 3Gi machine plus the 512Mi reserve")
	assert.Equal(t, 1, resizeCalls(r), "changed through the pod's resize subresource")

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "1Gi", dep.Spec.Template.Spec.Containers[0].Resources.Requests.Memory().String(),
		"the Deployment keeps the install's request: changing its template would recreate the pod and stop every machine")

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, 1, resizeCalls(r), "a request already right is left alone")

	agent.Annotations[annStopRequested] = time.Now().UTC().Format(time.RFC3339)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, "1Gi", runnerPodRequest(t, r), "a stopped machine gives its memory back, down to the install's own request")
}

// TEST_SCENARIO: the owner's other vm agents share the runner. A peer whose gateway is up should be running and counts toward the request; a peer that is stopped keeps only its disk, so it counts toward the claim but not the request.
func TestPeersCountByWhetherTheyShouldRun(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	peerVMAgent(t, r, "peer-up", "2Gi", "20Gi", true)
	peerVMAgent(t, r, "peer-down", "4Gi", "30Gi", false)

	d, err := r.ownerRunnerDemand(context.Background(), testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, runnerDemand{memoryMiB: 3072 + 2048, diskGiB: 10 + 20 + 30, machines: 3}, d)

	d, err = r.ownerRunnerDemand(context.Background(), testOwner, agent, false)
	require.NoError(t, err)
	assert.Equal(t, 2048, d.memoryMiB, "the agent being stopped no longer counts")
}

// TEST_SCENARIO: the request is held between two bounds. It never falls below the request the install set, and never rises above the limit, which the API refuses and which the runner would refuse to admit past anyway.
func TestTheRunnerRequestStaysBetweenTheInstallsRequestAndTheLimit(t *testing.T) {
	floor, limit := resource.MustParse("2Gi"), resource.MustParse("8Gi")
	low := runnerMemoryRequest(0, 512, floor, limit)
	assert.Equal(t, "2Gi", low.String())
	mid := runnerMemoryRequest(4096, 512, floor, limit)
	assert.Equal(t, "4608Mi", mid.String())
	high := runnerMemoryRequest(16384, 512, floor, limit)
	assert.Equal(t, "8Gi", high.String())
}

// TEST_SCENARIO: an install that sets only the limit gets a pod whose request Kubernetes defaulted to the limit. That is already the safest request there is, so nothing is lowered.
func TestAnInstallWithoutARequestKeepsItAtTheLimit(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	clusterResizesPods(r, true)
	runnerPod(t, r, "16Gi", "16Gi")

	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.Equal(t, "16Gi", runnerPodRequest(t, r))
	assert.Zero(t, resizeCalls(r))
}

// TEST_SCENARIO: a cluster whose API server has no pods/resize subresource keeps the behaviour it had. The agent still reconciles, the pod is not touched, and the controller asks discovery once rather than on every reconcile.
func TestAClusterWithoutInPlaceResizeKeepsReconciling(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	clusterResizesPods(r, false)
	runnerPod(t, r, "1Gi", "16Gi")
	ctx := context.Background()

	require.NoError(t, r.Reconcile(ctx, agent))
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.True(t, node.spec("my-agent").Running)
	assert.Equal(t, "1Gi", runnerPodRequest(t, r))
	assert.Zero(t, resizeCalls(r))
	asked := 0
	for _, a := range r.client.(*fake.Clientset).Actions() {
		if a.GetVerb() == "get" && a.GetResource().Resource == "resource" {
			asked++
		}
	}
	assert.Equal(t, 1, asked, "the answer is kept for the process")
}

// TEST_SCENARIO: a cluster that has the subresource but does not grant it to the controller refuses the resize. That is as permanent as a missing subresource, so it is reported once and not tried again.
func TestARefusedResizeIsNotRetried(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	r.client.(*fake.Clientset).PrependReactor("update", "pods", func(a k8stesting.Action) (bool, runtime.Object, error) {
		if a.GetSubresource() != "resize" {
			return false, nil, nil
		}
		return true, nil, k8serrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "runner", errors.New("pods/resize is not granted"))
	})
	ctx := context.Background()

	require.NoError(t, r.Reconcile(ctx, agent))
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, 1, resizeCalls(r))
}

// TEST_SCENARIO: one 10Gi agent must not cost a 100Gi claim. On a class that can expand, the claim holds the machine's disk, a GiB of headroom beside it, and the image cache budget when the cache lives on the claim — and grows as the owner adds agents, up to `runner.storage` and no further.
func TestTheRunnerClaimIsSizedFromDemandAndGrowsWithIt(t *testing.T) {
	ctx := context.Background()
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	expandableDefaultClass(t, r, true)

	require.NoError(t, r.applyRunnerPVC(ctx, testOwner, runnerDemand{diskGiB: 10, machines: 1}))
	assert.Equal(t, "61Gi", runnerClaim(t, r), "10Gi of disk, 1Gi of headroom and the 50Gi image cache budget")

	require.NoError(t, r.applyRunnerPVC(ctx, testOwner, runnerDemand{diskGiB: 30, machines: 2}))
	assert.Equal(t, "82Gi", runnerClaim(t, r), "a second agent grows the claim")

	require.NoError(t, r.applyRunnerPVC(ctx, testOwner, runnerDemand{diskGiB: 10, machines: 1}))
	assert.Equal(t, "82Gi", runnerClaim(t, r), "a claim is never shrunk")

	require.NoError(t, r.applyRunnerPVC(ctx, testOwner, runnerDemand{diskGiB: 200, machines: 4}))
	assert.Equal(t, "100Gi", runnerClaim(t, r), "runner.storage is the ceiling")
}

// TEST_SCENARIO: an install that puts the image cache on a node directory keeps no images on the claim, so the claim holds only the disks and their headroom.
func TestACacheOffTheClaimIsNotCountedOnIt(t *testing.T) {
	ctx := context.Background()
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	expandableDefaultClass(t, r, true)
	r.config.VM.Runner.ImageCacheHostPath = "/var/lib/platform-images"

	require.NoError(t, r.applyRunnerPVC(ctx, testOwner, runnerDemand{diskGiB: 10, machines: 1}))
	assert.Equal(t, "11Gi", runnerClaim(t, r))
}

// TEST_SCENARIO: a claim sized for today is safe only where it can grow tomorrow. On a class without volume expansion — or one the controller cannot read — the claim is created at `runner.storage`, as before, so the owner's next agent still fits.
func TestAClaimThatCouldNotGrowIsCreatedAtTheCeiling(t *testing.T) {
	for _, tc := range []struct {
		name  string
		setup func(t *testing.T, r *AgentReconciler)
	}{
		{"class without expansion", func(t *testing.T, r *AgentReconciler) { expandableDefaultClass(t, r, false) }},
		{"no class the controller can read", func(*testing.T, *AgentReconciler) {}},
		{"named class that is missing", func(_ *testing.T, r *AgentReconciler) { r.config.VM.Runner.StorageClass = "fast" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, _, _ := setupVMReconciler(t, vmAgentCR())
			tc.setup(t, r)
			require.NoError(t, r.applyRunnerPVC(context.Background(), testOwner, runnerDemand{diskGiB: 10, machines: 1}))
			assert.Equal(t, "100Gi", runnerClaim(t, r))
		})
	}
}

// TEST_SCENARIO: the owner's demand outgrows a claim whose class refuses to expand. The runner serves every vm agent of that owner and works exactly as before at the size it has, so the refusal must not fail the reconcile.
func TestAClaimThatCannotGrowKeepsTheRunnerReconciling(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	expandableDefaultClass(t, r, true)
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner, runnerDemand{}))
	require.Equal(t, "50Gi", runnerClaim(t, r))
	r.client.(*fake.Clientset).PrependReactor("update", "persistentvolumeclaims", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("persistentvolumeclaims %q is forbidden: only dynamically provisioned pvc can be resized and the storageclass that provisions the pvc must support resize", r.runnerName(testOwner))
	})

	require.NoError(t, r.Reconcile(ctx, agent), "a claim that cannot grow must not take the owner's runner with it")
	assert.Equal(t, "50Gi", runnerClaim(t, r), "the claim keeps the size it has")
}

// TEST_SCENARIO: a claim created under the old rule, at `runner.storage`, is already larger than its owner's demand. Kubernetes cannot shrink it, so it stays as it is.
func TestAnExistingLargerClaimStaysAsItIs(t *testing.T) {
	ctx := context.Background()
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner, runnerDemand{diskGiB: 10, machines: 1}))
	require.Equal(t, "100Gi", runnerClaim(t, r))
	expandableDefaultClass(t, r, true)

	require.NoError(t, r.applyRunnerPVC(ctx, testOwner, runnerDemand{diskGiB: 10, machines: 1}))
	assert.Equal(t, "100Gi", runnerClaim(t, r))
}

// TEST_SCENARIO: an install mistypes `runner.storage` after its owners' claims exist. Those claims keep the size they have and the runners keep reconciling, because a values typo must cost a warning rather than every owner's fleet.
func TestAMistypedCeilingLeavesExistingClaimsAlone(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner, runnerDemand{}))

	r.config.VM.Runner.Storage = "a lot"
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, "100Gi", runnerClaim(t, r))
}

func actionsOn(r *AgentReconciler, verb, resource string) int {
	n := 0
	for _, a := range r.client.(*fake.Clientset).Actions() {
		if a.GetVerb() == verb && a.GetResource().Resource == resource {
			n++
		}
	}
	for _, a := range r.dynamic.(*dynfake.FakeDynamicClient).Actions() {
		if a.GetVerb() == verb && a.GetResource().Resource == resource {
			n++
		}
	}
	return n
}

// TEST_SCENARIO: demand is read on every reconcile of every vm agent, and a starting machine is reconciled every half second. The owner's agents therefore come from the informer cache, and a peer's run decision from the controller's own memory of its last reconcile, so reading demand asks the cluster for nothing.
func TestDemandIsReadWithoutAskingTheCluster(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	peer := vmAgentCR()
	peer.Name = "peer"
	peer.Labels = map[string]string{envoyOwnerLabel: testOwner}
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, a := range []*apiv1.Agent{agent, peer} {
		u, err := agentToUnstructured(a)
		require.NoError(t, err)
		require.NoError(t, indexer.Add(u))
	}
	r.WithAgentCache(cache.NewGenericLister(indexer, AgentsGVR.GroupResource()))
	r.vmRunning.Store("peer", true)

	d, err := r.ownerRunnerDemand(context.Background(), testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 2*3072, d.memoryMiB)
	assert.Zero(t, actionsOn(r, "list", "agents"), "the owner's agents come from the cache")
	assert.Zero(t, actionsOn(r, "get", "statefulsets"), "a peer's decision comes from memory")
}

// TEST_SCENARIO: an accepted resize is only a request to the node. When the kubelet reports it pending — infeasible on this node, or deferred until there is room — the controller reports that, once per pod and size, rather than treating the memory as accounted for.
func TestAPendingResizeIsReportedOnce(t *testing.T) {
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "runner-abc"},
		Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{
			Type: corev1.PodResizePending, Status: corev1.ConditionTrue, Reason: corev1.PodReasonInfeasible, Message: "Node didn't have enough capacity",
		}}},
	}
	want := resource.MustParse("3584Mi")
	r.reportResizePending(testOwner, pod, want)
	r.reportResizePending(testOwner, pod, want)
	notices := 0
	r.resizeNotices.Range(func(any, any) bool { notices++; return true })
	assert.Equal(t, 1, notices)
}
