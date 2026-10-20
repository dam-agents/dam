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
	dynfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func applyUserBudget(t *testing.T, r *AgentReconciler, owner string, spec apiv1.UserBudgetSpec) {
	t.Helper()
	spec.Owner = owner
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&apiv1.UserBudget{
		ObjectMeta: metav1.ObjectMeta{Name: "budget-" + owner, Namespace: r.config.Namespace},
		Spec:       spec,
	})
	require.NoError(t, err)
	u := &unstructured.Unstructured{Object: raw}
	u.SetAPIVersion(apiv1.GroupVersion.String())
	u.SetKind("UserBudget")
	budgets := r.dynamic.Resource(UserBudgetsGVR).Namespace(r.config.Namespace)
	if _, err := budgets.Get(context.Background(), u.GetName(), metav1.GetOptions{}); err == nil {
		_, err = budgets.Update(context.Background(), u, metav1.UpdateOptions{})
		require.NoError(t, err)
		return
	}
	_, err = budgets.Create(context.Background(), u, metav1.CreateOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: a controller that has never read an owner's UserBudget — a cold start, or an API server that will not serve them — knows nothing about that owner's pool, and the install's default is smaller than some owners' pools and larger than others. Sized from that default, a claim grows to it and can never shrink again, and a memory limit falls under the machines already running on it and reclaims their owner's idle agents. Every decision that sets a size is refused and retried until the budget can be read; a pool read once is kept when a later read fails, so a moment of trouble does not undo it.
func TestAnUnreadUserBudgetRefusesEverySizeItCannotUndo(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "8Gi")
	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{
		Storage: new(resource.MustParse("12Gi")),
		Memory:  new(resource.MustParse("4Gi")),
	})
	unread := true
	r.dynamic.(*dynfake.FakeDynamicClient).PrependReactor("get", "userbudgets", func(k8stesting.Action) (bool, runtime.Object, error) {
		if !unread {
			return false, nil, nil
		}
		return true, nil, k8serrors.NewServiceUnavailable("the API server is not serving UserBudgets")
	})

	_, err := r.runnerStorageCeiling(ctx, testOwner)
	require.ErrorIs(t, err, errVMPoolUnread)

	require.ErrorIs(t, r.applyRunnerPVC(ctx, testOwner), errVMPoolUnread)
	_, err = r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "a claim was built at the install's 100Gi and can never come down to the owner's 12Gi")

	require.NoError(t, r.client.AppsV1().Deployments("test-agents").Delete(ctx, r.runnerName(testOwner), metav1.DeleteOptions{}))
	require.ErrorIs(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true), errVMPoolUnread)
	_, err = r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "a runner was built at the install's default limit")

	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	_, sized := r.runnerPodWants(ctx, testOwner, pod, runnerDemand{memoryMiB: 2048, vCPUs: 4})
	assert.False(t, sized, "the runner's memory limit was cut to the install's default under the machines running on it")

	require.ErrorContains(t, r.Reconcile(ctx, agent), errVMPoolUnread.Error())
	assert.Zero(t, node.spec(agent.Name).MemoryMiB, "a machine was sized from the install's default and started")

	unread = false
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner), "the claim is built once the budget can be read, rather than refused for good")
	assert.Equal(t, "12Gi", runnerClaim(t, r))

	r.vmPools.Delete(testOwner)
	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{Storage: new(resource.MustParse("30Gi"))})
	r.refreshVMPool(ctx, testOwner)
	unread = true
	kept, err := r.refreshVMPool(ctx, testOwner)
	require.NoError(t, err, "a pool read once is kept when a later read fails")
	assert.Equal(t, "30Gi", kept.storage.String())
	ceiling, err := r.runnerStorageCeiling(ctx, testOwner)
	require.NoError(t, err)
	assert.Equal(t, "30Gi", ceiling.String(), "the pool read before the failed read still sizes the ceiling")
}

// TEST_SCENARIO: an API server that will not serve an owner's UserBudget must not fail that owner's whole runner reconcile. A runner already built keeps the pod and the limits it has, because what the install's default renders is another pod: rolling it would cut the limit under the machines running on it and reboot every one of them. A stop still goes through, since only the decisions that would set a size from the pool wait for the read — otherwise every reconcile of each of their agents marks a healthy agent not ready, and reclaim, hibernation and the migration stops all skip exactly the window when the controller knows least.
func TestAnUnreadUserBudgetLeavesTheRunnerItHasAlone(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "8Gi")
	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{
		Storage: new(resource.MustParse("12Gi")),
		Memory:  new(resource.MustParse("4Gi")),
	})
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	before, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	require.Equal(t, "4Gi", before.Spec.Template.Spec.Containers[0].Resources.Limits.Memory().String())

	unread := true
	r.dynamic.(*dynfake.FakeDynamicClient).PrependReactor("get", "userbudgets", func(k8stesting.Action) (bool, runtime.Object, error) {
		if !unread {
			return false, nil, nil
		}
		return true, nil, k8serrors.NewServiceUnavailable("the API server is not serving UserBudgets")
	})
	r.vmPools.Delete(testOwner)

	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	after, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "4Gi", after.Spec.Template.Spec.Containers[0].Resources.Limits.Memory().String(),
		"the runner's limit fell to the install's default under the machines running on it")
	assert.Equal(t, before.Annotations[annRunnerTemplate], after.Annotations[annRunnerTemplate],
		"the runner was rolled for a pool this process has not read")

	require.ErrorContains(t, r.Reconcile(ctx, agent), "sizing the machine",
		"the runner build failed the reconcile for a pool this process has not read")
}

// TEST_SCENARIO: a stop needs no size, so an unread pool must not hold it: an agent the controller has asked to stop still reaches its runner and the machine goes down at what the runner already has. Refusing that would leave a machine up that the controller asked to stop, holding the room its stop releases.
func TestAnUnreadUserBudgetStillStopsAMachine(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	agent.Annotations[annStopRequested] = "true"
	r, node, _ := setupVMReconciler(t, agent)
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "8Gi")
	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{
		Storage: new(resource.MustParse("12Gi")),
		Memory:  new(resource.MustParse("4Gi")),
	})
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	unread := true
	r.dynamic.(*dynfake.FakeDynamicClient).PrependReactor("get", "userbudgets", func(k8stesting.Action) (bool, runtime.Object, error) {
		if !unread {
			return false, nil, nil
		}
		return true, nil, k8serrors.NewServiceUnavailable("the API server is not serving UserBudgets")
	})
	r.vmPools.Delete(testOwner)

	require.NoError(t, r.Reconcile(ctx, agent), "a stop was refused for a pool this process has not read")
	assert.False(t, node.spec(agent.Name).Running, "the machine was left running for an unread pool")
}

// TEST_SCENARIO: a machine that should run is still refused while the pool is unread, because its size is the one the controller would have to guess. The agent reads as not ready and its start is retried once the budget can be read, which is what the refusal is for.
func TestAnUnreadUserBudgetStillRefusesToSizeARunningMachine(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "8Gi")
	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{
		Storage: new(resource.MustParse("12Gi")),
		Memory:  new(resource.MustParse("4Gi")),
	})
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	require.NoError(t, r.applyRunnerDeployment(ctx, testOwner, r.runnerOwnerRef(ctx), true))
	up := int32(1)
	_, err := r.client.AppsV1().StatefulSets("test-agents").Create(ctx, &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: GatewayName(agent.Name), Namespace: "test-agents"},
		Spec:       appsv1.StatefulSetSpec{Replicas: &up},
	}, metav1.CreateOptions{})
	require.NoError(t, err)

	unread := true
	r.dynamic.(*dynfake.FakeDynamicClient).PrependReactor("get", "userbudgets", func(k8stesting.Action) (bool, runtime.Object, error) {
		if !unread {
			return false, nil, nil
		}
		return true, nil, k8serrors.NewServiceUnavailable("the API server is not serving UserBudgets")
	})
	r.vmPools.Delete(testOwner)

	require.ErrorContains(t, r.Reconcile(ctx, agent), errVMPoolUnread.Error(),
		"a running machine was sized from a pool this process has not read")
}

// TEST_SCENARIO: an owner's UserBudget `storage` is the ceiling of their runner's claim. An owner without one keeps `runner.storage`, and a budget read before the change is read again by refreshVMPool, which the memory pass calls every 30 seconds.
func TestAUserBudgetStorageIsTheOwnersClaimCeiling(t *testing.T) {
	ctx := context.Background()
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	ceiling, err := r.runnerStorageCeiling(ctx, testOwner)
	require.NoError(t, err)
	assert.Equal(t, "100Gi", ceiling.String())

	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{Storage: new(resource.MustParse("300Gi"))})
	ceiling, err = r.runnerStorageCeiling(ctx, testOwner)
	require.NoError(t, err)
	assert.Equal(t, "100Gi", ceiling.String(), "the pool read before the budget stays until it is read again")

	r.refreshVMPool(ctx, testOwner)
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner))
	assert.Equal(t, "300Gi", runnerClaim(t, r))

	ceiling, err = r.runnerStorageCeiling(ctx, "owner-2")
	require.NoError(t, err)
	assert.Equal(t, "100Gi", ceiling.String(), "another owner keeps the install's ceiling")
}

// TEST_SCENARIO: a UserBudget that sets only some fields leaves the container Ceiling's other dimension at the chart default, so a budget written for the VM pool alone does not shrink or lift the owner's container Ceiling.
func TestAUserBudgetFieldLeftOutKeepsTheContainerDefault(t *testing.T) {
	ctx := context.Background()
	r, _ := setupReconciler(t, agentCR())
	r.config.DefaultUserCPUBudget, r.config.DefaultUserMemoryBudget = resource.MustParse("8"), resource.MustParse("16Gi")

	applyUserBudget(t, r, budgetOwner, apiv1.UserBudgetSpec{CPU: new(resource.MustParse("2"))})
	cpu, mem, err := r.ceilingFor(ctx, budgetOwner)
	require.NoError(t, err)
	assert.Equal(t, "2", cpu.String())
	assert.Equal(t, "16Gi", mem.String())

	applyUserBudget(t, r, budgetOwner, apiv1.UserBudgetSpec{Storage: new(resource.MustParse("1Ti"))})
	cpu, mem, err = r.ceilingFor(ctx, budgetOwner)
	require.NoError(t, err)
	assert.Equal(t, "8", cpu.String())
	assert.Equal(t, "16Gi", mem.String())
}

// TEST_SCENARIO: a pool that rises is the runner's new limit at once; one that falls stops at what the running machines are counted at plus the reserve, rounded up to the request step, so the kernel never finds the runner over a limit lowered under it; and it never rises above the limit the pod has while it falls.
func TestARunnerLimitRisesToThePoolAndFallsOnlyAsUseAllows(t *testing.T) {
	gi := func(n int64) resource.Quantity { return *resource.NewQuantity(n<<30, resource.BinarySI) }
	raised := runnerMemoryLimit(24<<10, 9000, 512, gi(16))
	assert.Equal(t, "24Gi", raised.String())
	held := runnerMemoryLimit(4<<10, 10256, 512, gi(24))
	assert.Equal(t, "11Gi", held.String(), "10768Mi of machines and reserve, rounded up to 512Mi steps")
	freed := runnerMemoryLimit(4<<10, 1792, 512, gi(11))
	assert.Equal(t, "4Gi", freed.String())
	capped := runnerMemoryLimit(4<<10, 30000, 512, gi(11))
	assert.Equal(t, "11Gi", capped.String(), "a falling limit never rises past the one the pod has")
}

// TEST_SCENARIO: an owner's UserBudget `memory` reaches their running runner pod as its memory limit through the resize subresource, without a new pod: the Deployment's roll hash leaves the memory limit out, so the pool change rolls nothing. Lowered below what a measured machine holds, the limit stops at that machine's count, and the machine's next size is half the new pool.
func TestAUserBudgetMemoryResizesTheRunnerPodInPlace(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	require.NoError(t, r.Reconcile(ctx, agent))
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	template := dep.Annotations[annRunnerTemplate]

	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{Memory: new(resource.MustParse("24Gi"))})
	r.refreshVMPool(ctx, testOwner)
	require.NoError(t, r.Reconcile(ctx, agent))
	limit := runnerPodResources(t, r).Limits[corev1.ResourceMemory]
	assert.Equal(t, "24Gi", limit.String())
	dep, err = r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, template, dep.Annotations[annRunnerTemplate], "the pool change rolled the runner")

	r.noteMachineUse(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, CPUs: 4, MemoryMiB: 12032, UsedMiB: 10000})
	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{Memory: new(resource.MustParse("4Gi"))})
	r.refreshVMPool(ctx, testOwner)
	require.NoError(t, r.Reconcile(ctx, agent))
	limit = runnerPodResources(t, r).Limits[corev1.ResourceMemory]
	assert.Equal(t, "11Gi", limit.String(), "the limit stops at the measured machine plus headroom and reserve")
	size, err := r.machineMemoryMiB(ctx, testOwner, &agent.Spec)
	require.NoError(t, err)
	assert.Equal(t, (4096-512)/2, size)
}

// TEST_SCENARIO: runners rendered before the roll left their memory out carry a hash that covers the memory limit and request they were rendered with — the install's, even for an owner whose UserBudget already set `memory`. They have the pod the controller renders now in all but the memory the resize sets in place, so they must be recognised from their own template rather than rolled, which would reboot every machine of the owner. A pool below the install's request clamps the rendered request, which must not change the hash either.
func TestTheRollHashLeavesTheMemoryOutAndKnowsTheOldOne(t *testing.T) {
	spec := func(request, limit string) appsv1.DeploymentSpec {
		return appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{
			Name: vmRunnerComponent, Image: "runner:1",
			Resources: corev1.ResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse(request)},
				Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse(limit)},
			},
		}}}}}
	}
	install, err := runnerTemplateHash(runnerRollSpec(spec("8Gi", "16Gi")))
	require.NoError(t, err)
	raised, err := runnerTemplateHash(runnerRollSpec(spec("8Gi", "24Gi")))
	require.NoError(t, err)
	belowRequest, err := runnerTemplateHash(runnerRollSpec(spec("4Gi", "4Gi")))
	require.NoError(t, err)
	assert.Equal(t, install, raised)
	assert.Equal(t, install, belowRequest, "a pool below the install's request rolled the runner")

	before := spec("8Gi", "16Gi")
	before.Template.Spec.Containers[0].Image = ""
	old, err := runnerTemplateHash(before)
	require.NoError(t, err)
	assert.NotEqual(t, old, install)
	assert.Equal(t, old, legacyRunnerTemplateHash(spec("8Gi", "16Gi"), spec("8Gi", "16Gi")))
	assert.Equal(t, old, legacyRunnerTemplateHash(spec("4Gi", "4Gi"), spec("8Gi", "16Gi")),
		"an owner whose UserBudget already set memory was rendered at the install's memory, so the upgrade must not roll them")
	changed := spec("4Gi", "4Gi")
	changed.Template.Spec.Containers[0].Args = []string{"--boot-mib=1024"}
	assert.NotEqual(t, old, legacyRunnerTemplateHash(changed, spec("8Gi", "16Gi")), "a real pod change still rolls")
}

// TEST_SCENARIO: a UserBudget that changes only `cpu` must reach the running runner pod within one memory pass, not wait for one of the owner's agents to start or stop.
func TestACPUOnlyUserBudgetChangeResizesWithinOneMemoryPass(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	r.vmRunning.Store(agent.Name, true)
	node.mu.Lock()
	node.statuses[agent.Name] = measured(1000)
	node.mu.Unlock()
	require.NoError(t, r.Reconcile(ctx, agent))
	if _, moved := r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{agent}, nil); moved {
		require.NoError(t, r.Reconcile(ctx, agent))
	}
	_, moved := r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{agent}, nil)
	require.False(t, moved, "a pod already sized for its machines")

	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{CPU: new(resource.MustParse("6"))})
	name, moved := r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{agent}, nil)
	assert.True(t, moved)
	assert.Equal(t, agent.Name, name)
	require.NoError(t, r.Reconcile(ctx, agent))
	cpu := runnerPodResources(t, r).Limits[corev1.ResourceCPU]
	assert.Equal(t, "6", cpu.String())
}

// TEST_SCENARIO: an owner whose pool was read while they had no override, and whose UserBudget then sets `storage` while they have no runner, gets their first claim at the override: the memory pass never reads an owner with nothing running, and a claim built at the install's ceiling would keep that size for good.
func TestANewRunnerReadsTheOwnersPoolAgain(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	ceiling, err := r.runnerStorageCeiling(ctx, testOwner)
	require.NoError(t, err)
	assert.Equal(t, "100Gi", ceiling.String())

	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{Storage: new(resource.MustParse("12Gi"))})
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, "12Gi", runnerClaim(t, r))
}

// TEST_SCENARIO: a pool lowered while every machine of the owner slept sizes the next start from the new pool: the memory pass never reads an owner with nothing running, and a machine sized from the old pool keeps that size until its next start, past the whole pool it now shares.
func TestAMachineWokenAfterAPoolChangeIsSizedFromTheNewPool(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("24Gi")}}
	agent.Annotations[annLastActivity] = time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	require.NoError(t, r.Reconcile(ctx, agent))
	size, err := r.machineMemoryMiB(ctx, testOwner, &agent.Spec)
	require.NoError(t, err)
	assert.Equal(t, (24576-512)/2, size, "the pool was read while the agent slept")

	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{Memory: new(resource.MustParse("8Gi"))})
	agent.Annotations[annLastActivity] = time.Now().UTC().Format(time.RFC3339)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, (8192-512)/2, node.spec("my-agent").MemoryMiB)
}
