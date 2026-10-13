package reconciler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"

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

// TEST_SCENARIO: an owner's UserBudget `storage` is the ceiling of their runner's claim. An owner without one keeps `runner.storage`, and a budget read before the change is read again by refreshVMPool, which the memory pass calls every 30 seconds.
func TestAUserBudgetStorageIsTheOwnersClaimCeiling(t *testing.T) {
	ctx := context.Background()
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	big := runnerDemand{diskGiB: 500, machines: 5}

	_, ceiling, err := r.runnerClaimSize(ctx, testOwner, big)
	require.NoError(t, err)
	assert.Equal(t, "100Gi", ceiling.String())

	applyUserBudget(t, r, testOwner, apiv1.UserBudgetSpec{Storage: new(resource.MustParse("300Gi"))})
	_, ceiling, err = r.runnerClaimSize(ctx, testOwner, big)
	require.NoError(t, err)
	assert.Equal(t, "100Gi", ceiling.String(), "the pool read before the budget stays until it is read again")

	r.refreshVMPool(ctx, testOwner)
	size, ceiling, err := r.runnerClaimSize(ctx, testOwner, big)
	require.NoError(t, err)
	assert.Equal(t, "300Gi", ceiling.String())
	assert.Equal(t, 0, size.Cmp(ceiling))

	_, ceiling, err = r.runnerClaimSize(ctx, "owner-2", big)
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
	assert.Equal(t, (4096-512)/2, r.machineMemoryMiB(ctx, testOwner, &agent.Spec))
}

// TEST_SCENARIO: runners rendered before the roll left the memory limit out carry a hash that includes it. They have the pod the controller renders now, so they must be recognised rather than rolled, which would reboot every machine of every owner once.
func TestTheRollHashLeavesTheMemoryLimitOutAndKnowsTheOldOne(t *testing.T) {
	spec := func(mem string) appsv1.DeploymentSpec {
		return appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{
			Name: vmRunnerComponent, Image: "runner:1",
			Resources: corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse(mem)}},
		}}}}}
	}
	small, err := runnerTemplateHash(runnerRollSpec(spec("8Gi"), false))
	require.NoError(t, err)
	large, err := runnerTemplateHash(runnerRollSpec(spec("24Gi"), false))
	require.NoError(t, err)
	assert.Equal(t, small, large)

	old, err := runnerTemplateHash(spec("8Gi"))
	require.NoError(t, err)
	assert.Equal(t, old, legacyRunnerTemplateHash(spec("8Gi"), false))
	assert.NotEqual(t, old, small)
}
