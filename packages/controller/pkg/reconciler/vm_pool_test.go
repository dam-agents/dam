package reconciler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
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
