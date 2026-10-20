// TEST_OVERVIEW: a runner is sized from what its owner's vm agents ask of it. Its pod's memory request follows the memory of the machines that should be running plus the runner's reserve, between the install's request and the limit; its CPU limit follows the vCPUs of those machines plus one machine's worth for the runner, so one owner's runaway VMM cannot take the node; both are changed in place on the running pod — never on the Deployment, which would restart every machine — or left alone, with one warning, on a cluster that cannot resize pods. Its claim is the owner's storage pool, which every machine disk may grow into: it is created at the pool, grows when the pool rises, and never shrinks.
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
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/validation/field"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
	corelisters "k8s.io/client-go/listers/core/v1"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func runnerPod(t *testing.T, r *AgentReconciler, request, limit string) {
	t.Helper()
	res := corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse(limit)}}
	if request != "" {
		res.Requests = corev1.ResourceList{corev1.ResourceMemory: resource.MustParse(request)}
	}
	// TEST_SCENARIO: a running pod's kubelet reports what it allocated the container, which is the figure the runner admits against; a test that wants the node to report nothing clears it.
	status := corev1.PodStatus{Phase: corev1.PodRunning}
	if request != "" {
		status.ContainerStatuses = []corev1.ContainerStatus{{
			Name:               vmRunnerComponent,
			AllocatedResources: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse(request)},
		}}
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: r.runnerName(testOwner) + "-abc", Namespace: "test-agents", Labels: vmRunnerSelector(testOwner)},
		Spec:       corev1.PodSpec{NodeName: "kvm-1", Containers: []corev1.Container{{Name: vmRunnerComponent, Resources: res}}},
		Status:     status,
	}
	_, err := r.client.CoreV1().Pods("test-agents").Create(context.Background(), pod, metav1.CreateOptions{})
	require.NoError(t, err)
}

func runnerPodRequest(t *testing.T, r *AgentReconciler) string {
	t.Helper()
	q := runnerPodResources(t, r).Requests[corev1.ResourceMemory]
	return q.String()
}

func runnerPodResources(t *testing.T, r *AgentReconciler) corev1.ResourceRequirements {
	t.Helper()
	pod, err := r.client.CoreV1().Pods("test-agents").Get(context.Background(), r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	return pod.Spec.Containers[0].Resources
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

// TEST_SCENARIO: the admission ceiling is read from the node's view of the runner pod, so a list that cannot be read is not a zero ceiling: zero would hand the runner its whole limit back, the one admission this ceiling exists to bound.
// TEST_SCENARIO: a start held because the node reported no grant retries every few seconds, so a probe that only asks when the pod's spec has to change never asks where an earlier resize already made the spec what the demand wants: the hold would then wait for an answer nothing ever asks for. The ask is sent with the pod unchanged, because the API server validates it against what the running node supports.
func TestAHeldStartProbesTheResizeWhenTheSpecAlreadyMatches(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	demand, err := r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	runnerPodCarriesTheDemand(t, r, demand)
	runnerPodForgetsItsGrant(t, r)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped})
	require.False(t, r.runnerPodMoves(ctx, testOwner, demand), "the fixture's pod already carries what the demand asks")

	require.NoError(t, r.Reconcile(ctx, agent))

	assert.Positive(t, resizeCalls(r), "the hold never asked the node, so a node that cannot resize is never told apart from one that has not answered")
	assert.False(t, node.spec("my-agent").Running, "a start with no grant to admit against went ahead")
}

// TEST_SCENARIO: a node without in-place resize answers the probe with an invalid, the shape a pod that reports no grant presents. Reading that as a failure to log and retry holds the start for ever, where reading it as unsupported resize admits the start against the limit, which is what an install whose cluster cannot resize does for every start.
func TestAResizeTheNodeCannotCarryEndsTheHoldWithoutACeiling(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	demand, err := r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	runnerPodCarriesTheDemand(t, r, demand)
	runnerPodForgetsItsGrant(t, r)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped})
	r.client.(*fake.Clientset).PrependReactor("update", "pods", func(a k8stesting.Action) (bool, runtime.Object, error) {
		if a.GetSubresource() != "resize" {
			return false, nil, nil
		}
		return true, nil, k8serrors.NewInvalid(schema.GroupKind{Kind: "Pod"}, a.(k8stesting.UpdateAction).GetObject().(metav1.Object).GetName(),
			field.ErrorList{field.Invalid(field.NewPath("spec", "containers").Index(0).Child("resources"), nil, "pod resize is not supported by the node")})
	})

	require.NoError(t, r.Reconcile(ctx, agent), "the invalid the node answers with was treated as a failure to retry")
	require.NoError(t, r.Reconcile(ctx, agent))

	assert.True(t, node.spec("my-agent").Running, "the start never went ahead although the node cannot report a grant")
	assert.Zero(t, node.spec("my-agent").AdmitMiB, "a node that cannot report a grant was admitted against a ceiling, where an install without in-place resize admits against the limit")
}

// TEST_SCENARIO: a hold resolves in the other direction too, and it resolves against the figure the node reports rather than the pool: the retry after the node starts reporting admits the start at what the node granted it.
func TestALaterGrantAdmitsTheHeldStart(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	runnerPodForgetsItsGrant(t, r)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped})

	require.NoError(t, r.Reconcile(ctx, agent))
	require.False(t, node.spec("my-agent").Running, "the start went ahead with no grant to admit against")

	runnerPodReportsItsGrant(t, r, "9Gi")
	require.NoError(t, r.Reconcile(ctx, agent))

	assert.True(t, node.spec("my-agent").Running, "the start did not go ahead once the node reported its grant")
	assert.Equal(t, 9216, node.spec("my-agent").AdmitMiB, "the start was admitted against something other than the grant the node reported")
}

// TEST_SCENARIO: the hold has to end in a state that names the problem, since nothing the owner does supplies a figure the node never reported. The start keeps holding and is retried at the parked tick, so the promise of an automatic start has a way out that a person can see and act on.
func TestAHeldStartEndsInANamedStateAfterTheBound(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	runnerPodForgetsItsGrant(t, r)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped})
	r.grantHolds.Store("my-agent", time.Now().Add(-grantUnreadableBound-time.Second))

	require.NoError(t, r.Reconcile(ctx, agent))

	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonAllocationUnreadable, cond.Reason, "a start held past the bound still reads as waiting for the node")
	assert.Contains(t, cond.Message, "has not reported")
	assert.False(t, node.spec("my-agent").Running, "a start with no grant to admit against went ahead")
}

func TestAnUnreadableRunnerPodListStopsTheStartRatherThanAdmittingAgainstTheWholePool(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	clusterResizesPods(r, true)
	r.runnerPodCache = refusingPodLister{}

	_, err := r.runnerAdmitMiB(context.Background(), testOwner)
	require.ErrorContains(t, err, "pod list refused")
}

// TEST_SCENARIO: a start waiting for the node counts toward the request that must grow for it, so its reason stays out of the ones that hold nothing: if it were refused, the request would never grow past what the machines that are not waiting need, and the retry would be refused for ever.
func TestAStartWaitingForTheNodeCountsTowardTheRequest(t *testing.T) {
	assert.False(t, refusedReason(vmrunner.ReasonAwaitingAllocation))
	assert.True(t, refusedReason(vmrunner.ReasonOutOfCapacity))
}

// TEST_SCENARIO: a kubelet may report a container status that carries no resources at all. Reading through it once crashed the controller, and reading the request the pod's spec carries instead admits the start against a figure the node has not enacted: after the controller asks for a resize, that spec request is its own ask, which a node may have deferred. The start is held until the node reports what it holds, and the resize it needs is asked for in the same reconcile so that report can come.
func TestARunnerWhoseNodeReportsNothingHoldsTheStart(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	runnerPod(t, r, "1Gi", "16Gi")
	clusterResizesPods(r, true)
	ctx := context.Background()

	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{Name: vmRunnerComponent}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.False(t, node.spec("my-agent").Running, "the request the pod carries is the controller's ask, not what the node holds")
	assert.Equal(t, apiv1.ReasonAwaitingAllocation, readyCondition(t, r, "my-agent").Reason)

	pod, err = r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Spec.Containers[0].Resources.Requests[corev1.ResourceMemory] = resource.MustParse("8Gi")
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{Name: vmRunnerComponent}}
	pod.Status.Conditions = []corev1.PodCondition{{Type: corev1.PodResizePending, Status: corev1.ConditionTrue, Reason: corev1.PodReasonDeferred}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)

	// TEST_SCENARIO: the deferred ask is not a figure to admit against either, however long it waits.
	admit, err := r.runnerAdmitMiB(ctx, testOwner)
	require.ErrorIs(t, err, errGrantUnknown, "a deferred resize with no reported figure has none to give, and its ask is not that figure")
	assert.Zero(t, admit)
}

// TEST_SCENARIO: a cluster that will not say whether it resizes pods leaves the node's grant unknown, and unknown is not a licence to admit against the whole pool: every other unread figure in this flow stops the decision instead of standing in for zero.
func TestAClusterThatCannotSayWhetherItResizesAdmitsNothing(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.client.(*fake.Clientset).Discovery().(*fakediscovery.FakeDiscovery).Resources = nil

	_, err := r.runnerAdmitMiB(context.Background(), testOwner)
	require.ErrorContains(t, err, "resize support cannot be read")
}

// UNIT_BOUNDARY_DESCRIPTION: a pod lister whose every read fails, standing in for an informer that has not synced or an API read that failed.
type refusingPodLister struct{ corelisters.PodLister }

func (refusingPodLister) Pods(string) corelisters.PodNamespaceLister { return refusingPodNamespace{} }

type refusingPodNamespace struct{ corelisters.PodNamespaceLister }

func (refusingPodNamespace) List(labels.Selector) ([]*corev1.Pod, error) {
	return nil, errors.New("pod list refused")
}

// TEST_SCENARIO: a test that wants the node to report nothing it holds clears the container status of the running pod.
func runnerPodForgetsItsGrant(t *testing.T, r *AgentReconciler) {
	t.Helper()
	ctx := context.Background()
	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{Name: vmRunnerComponent}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: a node that starts reporting what it holds, as a kubelet with the feature gate turns one on, gives the hold the figure it waited for.
func runnerPodReportsItsGrant(t *testing.T, r *AgentReconciler, allocated string) {
	t.Helper()
	ctx := context.Background()
	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:               vmRunnerComponent,
		AllocatedResources: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse(allocated)},
	}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: the pod's spec is set to exactly what the owner's demand asks, as an earlier resize leaves it on a node that never reports the result, so a further resize would ask for nothing new.
func runnerPodCarriesTheDemand(t *testing.T, r *AgentReconciler, demand runnerDemand) {
	t.Helper()
	ctx := context.Background()
	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	want, ok := r.runnerPodWants(ctx, testOwner, pod, demand)
	require.True(t, ok)
	res := &pod.Spec.Containers[0].Resources
	res.Requests[corev1.ResourceMemory] = want.memoryRequest
	res.Limits[corev1.ResourceMemory] = want.memoryLimit
	res.Limits[corev1.ResourceCPU] = want.cpu
	_, err = r.client.CoreV1().Pods("test-agents").Update(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
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

// TEST_SCENARIO: the runner admits machines against its memory limit while the scheduler sees only the request. A machine that wakes must raise the request in the reconcile that starts it, by the machine's memory on top of the runner's reserve, and a stop must hand that memory back — so a busy node does not OOM-kill a machine of this owner.
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
	assert.Equal(t, "8704Mi", runnerPodRequest(t, r), "the unmeasured machine at half the runner's 15.5Gi plus the 512Mi reserve, in 512Mi steps")
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

// TEST_SCENARIO: a wake is timed to the machine's start, and the resize is a list of the runner's pods and a write to one, about 30 ms on dev, that the machine's start does not read: the request only tells the scheduler what the runner already admits against its limit, and the node applies it on its own time. So the machine is asked for first, and the request is raised in the same reconcile right after.
func TestTheMachineIsAskedForBeforeTheRunnerPodIsResized(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	machinesBeforeResize := -1
	r.client.(*fake.Clientset).PrependReactor("update", "pods", func(a k8stesting.Action) (bool, runtime.Object, error) {
		if a.GetSubresource() == "resize" {
			node.mu.Lock()
			machinesBeforeResize = len(node.puts)
			node.mu.Unlock()
		}
		return false, nil, nil
	})

	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.Equal(t, 1, machinesBeforeResize, "the runner had the machine before the pod's resize was sent")
	assert.Equal(t, "8704Mi", runnerPodRequest(t, r), "the resize still lands in the same reconcile")
}

// TEST_SCENARIO: the owner's other vm agents share the runner. A peer whose gateway is up should be running and counts toward the request; a peer that is stopped does not.
func TestPeersCountByWhetherTheyShouldRun(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	peerVMAgent(t, r, "peer-up", "2Gi", "20Gi", true)
	peerVMAgent(t, r, "peer-down", "4Gi", "30Gi", false)

	d, err := r.ownerRunnerDemand(context.Background(), testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, runnerDemand{memoryMiB: 3072 + 2048, vCPUs: 2 * max(r.config.VM.Runner.MachineCPUs, 1)}, d)

	d, err = r.ownerRunnerDemand(context.Background(), testOwner, agent, false)
	require.NoError(t, err)
	assert.Equal(t, 2048, d.memoryMiB, "the agent being stopped no longer counts")
}

// TEST_SCENARIO: the request is held between two bounds. It never falls below the request the install set, and never rises above the limit, which the API refuses and which the runner would refuse to admit past anyway.
func TestTheRunnerRequestStaysBetweenTheInstallsRequestAndTheLimit(t *testing.T) {
	floor, limit := resource.MustParse("2Gi"), resource.MustParse("8Gi")
	low := runnerMemoryRequest(0, 512, resource.Quantity{}, floor, limit)
	assert.Equal(t, "2Gi", low.String())
	mid := runnerMemoryRequest(4096, 512, resource.Quantity{}, floor, limit)
	assert.Equal(t, "4608Mi", mid.String())
	high := runnerMemoryRequest(16384, 512, resource.Quantity{}, floor, limit)
	assert.Equal(t, "8Gi", high.String())
}

// TEST_SCENARIO: a guest whose use sits on a 512 MiB step boundary must not flip the request between two steps at every pass. The request rises as soon as the need passes the current step, and falls only once the need is a quarter step below the step under it.
func TestTheRunnerRequestFallsOnlyClearlyBelowTheCurrentStep(t *testing.T) {
	floor, limit, current := resource.MustParse("1Gi"), resource.MustParse("8Gi"), resource.MustParse("2Gi")
	up := runnerMemoryRequest(2049-512, 512, current, floor, limit)
	assert.Equal(t, "2560Mi", up.String())
	current = up
	held := runnerMemoryRequest(2040-512, 512, current, floor, limit)
	assert.Equal(t, "2560Mi", held.String())
	down := runnerMemoryRequest(1920-512, 512, current, floor, limit)
	assert.Equal(t, "2Gi", down.String())
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
}

// TEST_SCENARIO: on dam-dev one runaway VMM took 75 of a node's 80 cores, because the runner pod had no CPU limit. Every machine is a VMM process in its owner's runner pod, so the pod's CPU limit caps the owner's machines together. It must cover the vCPUs of every machine that should run, or guests are throttled under normal load, plus one machine's worth for the runner and the VMMs' I/O threads; a limit the install sets caps it. It changes in place as machines start and stop, and the Deployment carries the owner's whole CPU pool — the most a resize can give the pod — so a new or replaced pod is never throttled below its machines' vCPUs on a cluster that never applies a resize. An install that sets no CPU limit anywhere has no pool of its own, so the bound it renders comes from the memory pool it does set — and only an install with no memory limit, or no warm-up floor to divide it by, carries none.
func TestTheRunnerCPULimitFollowsTheMachinesThatShouldRun(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits: corev1.ResourceList{
			corev1.ResourceMemory: resource.MustParse("16Gi"),
			corev1.ResourceCPU:    resource.MustParse("20"),
		},
	}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	peerVMAgent(t, r, "peer-up", "2Gi", "20Gi", true)
	peerVMAgent(t, r, "peer-down", "2Gi", "20Gi", false)
	ctx := context.Background()

	require.NoError(t, r.Reconcile(ctx, agent))
	res := runnerPodResources(t, r)
	assert.Equal(t, "12", res.Limits.Cpu().String(), "two running machines of 4 vCPUs, plus 4 for the runner")
	assert.True(t, res.Requests.Cpu().IsZero(), "a pod with no CPU request keeps none, rather than the API defaulting it to the limit")
	assert.Contains(t, res.Requests, corev1.ResourceCPU, "the zero request is explicit, or the API would default it to the limit")

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "20", dep.Spec.Template.Spec.Containers[0].Resources.Limits.Cpu().String(),
		"the Deployment carries the whole CPU pool: a new or replaced pod is never throttled below its machines, whether or not a resize ever lands")

	agent.Annotations[annStopRequested] = time.Now().UTC().Format(time.RFC3339)
	require.NoError(t, r.Reconcile(ctx, agent))
	res = runnerPodResources(t, r)
	assert.Equal(t, "8", res.Limits.Cpu().String(), "a stopped machine gives its vCPUs back")
}

// TEST_SCENARIO: the CPU limit is held between two bounds. It never falls below the pod's CPU request, which the API refuses, and never rises above a CPU limit the install set itself. With no machine running it keeps one machine's worth, so the next start is not throttled before its resize lands.
func TestTheRunnerCPULimitStaysBetweenTheRequestAndTheInstallsLimit(t *testing.T) {
	none := resource.Quantity{}
	idle := runnerCPULimit(0, 4, none, nil)
	assert.Equal(t, "4", idle.String())
	busy := runnerCPULimit(20, 4, none, nil)
	assert.Equal(t, "24", busy.String())
	ceiling := resource.MustParse("16")
	capped := runnerCPULimit(20, 4, none, &ceiling)
	assert.Equal(t, "16", capped.String())
	floored := runnerCPULimit(0, 4, resource.MustParse("6"), nil)
	assert.Equal(t, "6", floored.String())
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

// TEST_SCENARIO: the owner label also selects runner pods a roll or an eviction left behind, Failed or Succeeded, and a pod still terminating. Resizing them does nothing for the machines and repeats on every reconcile, so only the live pod is resized.
func TestADeadRunnerPodIsNeverResized(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	clusterResizesPods(r, true)
	ctx := context.Background()
	now := metav1.Now()
	for name, status := range map[string]corev1.PodStatus{
		"failed":  {Phase: corev1.PodFailed},
		"evicted": {Phase: corev1.PodFailed, Reason: "Evicted"},
		"done":    {Phase: corev1.PodSucceeded},
		"leaving": {Phase: corev1.PodRunning},
	} {
		pod := &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: r.runnerName(testOwner) + "-" + name, Namespace: "test-agents", Labels: vmRunnerSelector(testOwner)},
			Spec: corev1.PodSpec{NodeName: "kvm-1", Containers: []corev1.Container{{Name: vmRunnerComponent, Resources: corev1.ResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
				Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
			}}}},
			Status: status,
		}
		if name == "leaving" {
			pod.DeletionTimestamp, pod.Finalizers = &now, []string{"test/hold"}
		}
		_, err := r.client.CoreV1().Pods("test-agents").Create(ctx, pod, metav1.CreateOptions{})
		require.NoError(t, err)
	}

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Zero(t, resizeCalls(r), "no dead or terminating runner pod is resized")

	runnerPod(t, r, "1Gi", "16Gi")
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, 1, resizeCalls(r), "the live pod beside them is")
}

// TEST_SCENARIO: every machine disk may grow to the owner's whole pool, so the claim is created at the pool, grows when the pool rises, and is never shrunk when it falls.
func TestTheRunnerClaimIsThePoolAndGrowsWithIt(t *testing.T) {
	ctx := context.Background()
	r, _, _ := setupVMReconciler(t, vmAgentCR())

	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	assert.Equal(t, "100Gi", runnerClaim(t, r))

	r.config.VM.Runner.Storage = "200Gi"
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	assert.Equal(t, "200Gi", runnerClaim(t, r), "a larger pool grows the claim")

	r.config.VM.Runner.Storage = "50Gi"
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	assert.Equal(t, "200Gi", runnerClaim(t, r), "a claim is never shrunk")
}

// TEST_SCENARIO: the owner's pool outgrows a claim whose class refuses to expand. The runner serves every vm agent of that owner and works exactly as before at the size it has, so the refusal must not fail the reconcile.
func TestAClaimThatCannotGrowKeepsTheRunnerReconciling(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	require.Equal(t, "100Gi", runnerClaim(t, r))
	r.config.VM.Runner.Storage = "200Gi"
	r.client.(*fake.Clientset).PrependReactor("update", "persistentvolumeclaims", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("persistentvolumeclaims %q is forbidden: only dynamically provisioned pvc can be resized and the storageclass that provisions the pvc must support resize", r.runnerName(testOwner))
	})

	require.NoError(t, r.Reconcile(ctx, agent), "a claim that cannot grow must not take the owner's runner with it")
	assert.Equal(t, "100Gi", runnerClaim(t, r), "the claim keeps the size it has")
}

// TEST_SCENARIO: an install mistypes `runner.storage` after its owners' claims exist. Those claims keep the size they have and the runners keep reconciling, because a values typo must cost a warning rather than every owner's fleet.
func TestAMistypedCeilingLeavesExistingClaimsAlone(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))

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

// TEST_SCENARIO: a node short of disk evicts first the pods over their ephemeral-storage request, and a runner with none is over it at any use, so every machine of its owner dies with it. The runner asks for 1Gi unless the install sets its own request, which is kept, or a lower ephemeral-storage limit, which the request then matches.
func TestARunnerPodRequestsEphemeralStorageSoDiskPressureEvictsItLast(t *testing.T) {
	render := func(install *corev1.ResourceRequirements) resource.Quantity {
		agent := vmAgentCR()
		r, _, _ := setupVMReconciler(t, agent)
		if install != nil {
			r.config.VM.Runner.Resources = install
		}
		require.NoError(t, r.Reconcile(context.Background(), agent))
		dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
		require.NoError(t, err)
		return dep.Spec.Template.Spec.Containers[0].Resources.Requests[corev1.ResourceEphemeralStorage]
	}
	got := render(nil)
	assert.Equal(t, "1Gi", got.String())
	got = render(&corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceEphemeralStorage: resource.MustParse("5Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("8Gi")},
	})
	assert.Equal(t, "5Gi", got.String())
	got = render(&corev1.ResourceRequirements{
		Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("8Gi"), corev1.ResourceEphemeralStorage: resource.MustParse("512Mi")},
	})
	assert.Equal(t, "512Mi", got.String(), "a request above the install's limit is refused at admission")
}

// TEST_SCENARIO: a claim whose class refuses to expand is applied on the reconcile of every one of the owner's agents, so QA read the same refusal three times in one burst. It names what an operator has to fix and nothing changes between the attempts, so it is said once per size the claim is asked for, and said again only when the pool asks for another one.
func TestAClaimThatCannotGrowIsSaidOnce(t *testing.T) {
	ctx := context.Background()
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	r.config.VM.Runner.Storage = "200Gi"
	r.client.(*fake.Clientset).PrependReactor("update", "persistentvolumeclaims", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("persistentvolumeclaims %q is forbidden: only dynamically provisioned pvc can be resized and the storageclass that provisions the pvc must support resize", r.runnerName(testOwner))
	})
	const notGrown = "vm runner: the claim was not grown, the runner keeps the size it has"
	said := func(messages []string) int {
		n := 0
		for _, m := range messages {
			if m == notGrown {
				n++
			}
		}
		return n
	}
	warnings := captureWarnings(t)

	for i := 0; i < 3; i++ {
		require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	}
	assert.Equal(t, 1, said(warningMessages(*warnings)), "one burst says it once")

	r.config.VM.Runner.Storage = "300Gi"
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	assert.Equal(t, 2, said(warningMessages(*warnings)), "a size nobody has been told about yet is said once")

	r.config.VM.Runner.Storage = "50Gi"
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	r.config.VM.Runner.Storage = "300Gi"
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	assert.Equal(t, 3, said(warningMessages(*warnings)), "a pool that fell and rose again says it again")
}

// TEST_SCENARIO: the runner admits machines against its pod's memory limit, which is the owner's whole pool and far above what the node has reserved for that pod while an in-place resize waits for room. A runner that admitted to its limit on a busy node is the pod the kubelet evicts, or the one that OOMs, and it takes every machine of that owner with it — so each ensure carries the memory the node granted, which the runner admits against. The figure is the node's allocation of the runner container, read off the pod; a kubelet that reports none leaves the request the pod carries; a runner with no pod yet sends no ceiling, since that reconcile is the one that builds it; and a cluster that cannot resize the pod sends none either, since the request there is the install's fixed floor rather than memory the node can be asked for more of.
func TestAMachineIsAdmittedAgainstWhatTheNodeGranted(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	runnerPod(t, r, "1Gi", "16Gi")
	clusterResizesPods(r, true)
	ctx := context.Background()

	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:               vmRunnerComponent,
		AllocatedResources: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("9Gi")},
	}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, 9216, node.specs["my-agent"].AdmitMiB, "what the node allocated, which differs from the spec while a resize waits")

	pod, err = r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{Name: vmRunnerComponent}}
	pod.Spec.Containers[0].Resources.Requests[corev1.ResourceMemory] = resource.MustParse("8Gi")
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:      vmRunnerComponent,
		Resources: &corev1.ResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("2Gi")}},
	}}
	pod.Status.Conditions = []corev1.PodCondition{{
		Type: corev1.PodResizePending, Status: corev1.ConditionTrue, Reason: corev1.PodReasonDeferred,
	}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, 2048, node.specs["my-agent"].AdmitMiB,
		"the request the node reports holding, not the one the resize asked for: a deferred resize grants nothing")

	unresizable := vmAgentCR()
	other, otherNode, _ := setupVMReconciler(t, unresizable)
	other.config.VM.Runner.Resources = r.config.VM.Runner.Resources
	runnerPod(t, other, "1Gi", "16Gi")
	clusterResizesPods(other, false)
	require.NoError(t, other.Reconcile(ctx, unresizable))
	assert.Zero(t, otherNode.specs["my-agent"].AdmitMiB, "a cluster that cannot resize the pod grants no more than the install's floor, so the pool stays the ceiling")
}

// TEST_SCENARIO: the request in the pod's spec is the controller's ask from the moment it makes one, and the node may defer that ask for as long as it has no room. A re-ask while the resize is pending rewrites the spec again, so reading the spec as a figure the node enacted would raise the ceiling to what the controller asked for, which is the reading this ceiling exists to prevent. The last figure the node did enact stays the ceiling until the node reports a new one.
func TestAReAskDuringAPendingResizeKeepsTheCeilingAtWhatTheNodeEnacted(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	runnerPod(t, r, "1Gi", "16Gi")
	clusterResizesPods(r, true)
	ctx := context.Background()

	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:      vmRunnerComponent,
		Resources: &corev1.ResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")}},
	}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, 1024, node.specs["my-agent"].AdmitMiB, "the memory the pod was placed with")

	pod, err = r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Spec.Containers[0].Resources.Requests[corev1.ResourceMemory] = resource.MustParse("8Gi")
	pod.Status.ContainerStatuses[0].Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("2Gi")},
	}
	pod.Status.Conditions = []corev1.PodCondition{{
		Type: corev1.PodResizePending, Status: corev1.ConditionTrue, Reason: corev1.PodReasonDeferred,
	}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, 2048, node.specs["my-agent"].AdmitMiB,
		"the figure the node reports holding, not the 8 GiB the controller asked for however often it asks")
}

// TEST_SCENARIO: the CPU limit reached the runner only through an in-place resize, so a pod ran unbounded from its first second until that resize landed, and forever on a cluster that cannot resize — where one runaway VMM took 75 of a node's 80 cores. The pod is rendered at the owner's whole CPU pool, the most a resize would ever give it, and an explicit zero CPU request beside it, because the API defaults a missing request to the limit, which would reserve those vCPUs on the node and could change the pod's QoS class, which a resize may not do. With no CPU pool and no install limit, the limit comes from the memory pool and the warm-up floor, and an install with neither renders none; the request is zero either way.
func TestTheRunnerPodIsCreatedWithItsCPULimit(t *testing.T) {
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	r.config.VM.Runner.MachineCPUs = 4
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Limits: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("12")},
	}
	require.NoError(t, r.applyRunnerDeployment(context.Background(), testOwner, r.runnerOwnerRef(context.Background()), true))
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	res := dep.Spec.Template.Spec.Containers[0].Resources
	assert.Equal(t, "12", res.Limits.Cpu().String(), "the whole CPU pool, the most a resize would ever give the pod")
	request, ok := res.Requests[corev1.ResourceCPU]
	require.True(t, ok, "an explicit zero request, or admission defaults the request to the limit")
	assert.True(t, request.IsZero())
}

// TEST_SCENARIO: an owner's CPU pool can be smaller than the CPU request the install renders, and a pod whose request is above its limit is one the API refuses: that owner's first runner, or the next real roll of it, would never be created. The request follows the pool down at creation, as the memory request does.
func TestARunnerIsCreatedWithItsCPURequestWithinTheOwnersPool(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("2")},
		Limits:   corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("8")},
	}
	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{CPU: new(resource.MustParse("1"))})
	r.refreshVMPool(ctx, testOwner)

	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	res := dep.Spec.Template.Spec.Containers[0].Resources
	assert.Equal(t, "1", res.Limits.Cpu().String(), "the owner's pool")
	assert.Equal(t, "1", res.Requests.Cpu().String(), "a request above the limit is a pod the API refuses")
}

// TEST_SCENARIO: an install that sets only the memory it gives a runner has no CPU figure anywhere, and an unbounded runner is what let one runaway VMM take 75 of a node's 80 cores. The creation bound comes from the memory pool instead: every machine the pool can hold at the warm-up floor, plus one more for the runner.
func TestAMemoryOnlyInstallStillGetsACreationCPUBound(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.MachineCPUs = 4
	r.config.VM.Runner.BootMiB = 3072
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}

	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	limit, ok := dep.Spec.Template.Spec.Containers[0].Resources.Limits[corev1.ResourceCPU]
	require.True(t, ok, "a runner with no CPU limit is one runaway VMM away from taking the node")
	assert.Equal(t, "24", limit.String(), "five machines fit 16 GiB at 3 GiB each, and the runner gets one more")
}

// TEST_SCENARIO: an install that sets only the memory it gives the runner and no warm-up floor has no machine size to divide that pool by, and a bound that then renders none leaves the runner without a CPU limit at creation — exactly the runaway VMM the bound exists for, and for ever on a cluster that cannot resize. Two machines' worth is the bound: each may take half the pool, so a pair still runs and no single VMM takes the node.
func TestAZeroWarmUpFloorStillGetsACreationCPUBound(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.MachineCPUs = 4
	r.config.VM.Runner.BootMiB = 0
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}

	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	limit, ok := dep.Spec.Template.Spec.Containers[0].Resources.Limits[corev1.ResourceCPU]
	require.True(t, ok, "a runner with no CPU limit is one runaway VMM away from taking the node")
	assert.Equal(t, "8", limit.String(), "with no floor to divide the pool by, two machines bound the runner's guests")
}

// TEST_SCENARIO: one runner pod holds every machine of one owner, so a node under memory pressure evicting it, or a full node preempting it, costs that owner every agent they have at once, where an agent pod costs one. Runner pods carry the PriorityClass the chart renders for them, which sits above the agent pods that carry none.
func TestTheRunnerCarriesThePriorityClassTheChartGivesIt(t *testing.T) {
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	r.config.VM.Runner.PriorityClassName = "platform-vm-runner-priority"
	require.NoError(t, r.applyRunnerDeployment(context.Background(), testOwner, r.runnerOwnerRef(context.Background()), true))
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "platform-vm-runner-priority", dep.Spec.Template.Spec.PriorityClassName)
}
