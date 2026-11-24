// TEST_OVERVIEW: a start that waits for the node gets room within one grace, counted from the first pass that found it waiting. Neither a changing ask nor a controller count below the runner's own may hold it past that grace.
package reconciler

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// TEST_SCENARIO: the owner's demand moves while the start waits, as it did when the runner's request went from 3584Mi to 3Gi to 6Gi during one wake. Each changed ask begins a grace of its own, so the grace of the ask never runs out. The start's own wait does: once it has waited a grace in all, the idle machine is reclaimed, although the current ask is still fresh.
func TestAChangingAskStillReclaimsWithinOneGrace(t *testing.T) {
	ctx, r, agent := deferredResizeWithWaits(t, true)

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Empty(t, reclaimedAt(t, r, "idle-peer"), "the first pass of a wait frees nothing")
	firstAsk := theRecordedAsk(t, r)

	// TEST_SCENARIO: the idle machine's use moves, so the next pass sizes a different ask, which starts its own grace.
	r.noteMachineUse("idle-peer", measured(2816))
	require.NoError(t, r.Reconcile(ctx, agent))
	require.NotEqual(t, firstAsk, theRecordedAsk(t, r), "precondition: the ask changed")
	require.True(t, r.reclaimWaitsForTheReducedAsk(testOwner), "precondition: the changed ask's own grace is fresh")
	assert.Empty(t, reclaimedAt(t, r, "idle-peer"), "a start inside its first grace still frees nothing")

	// TEST_SCENARIO: the start has now waited a whole grace, and the ask changes once more.
	backdateTheAllocationWait(t, r, agent.Name)
	r.noteMachineUse("idle-peer", measured(3328))
	require.NoError(t, r.Reconcile(ctx, agent))
	require.True(t, r.reclaimWaitsForTheReducedAsk(testOwner), "precondition: the newest ask's grace is fresh")
	assert.NotEmpty(t, reclaimedAt(t, r, "idle-peer"),
		"the start has waited a grace in all, so the idle machine frees its room whatever the ask did")
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonAwaitingAllocation, cond.Reason, "the start still reads as waiting, so a wake keeps waiting for it")
}

// TEST_SCENARIO: the runner refuses the start against its own count of what its machines commit, and that count can be above the controller's: a machine that warms counts at the warm-up floor there. Here the controller's count says the grant holds one more machine, so no ask is stepped and no resize is pending, and a reclaim from that count would free nothing. After one grace the room is taken from the runner's own count, so the idle machine is reclaimed.
func TestAWaitTheControllerUndercountsStillReclaimsAfterOneGrace(t *testing.T) {
	ctx, r, node, agent := deferredResizeOnNode(t, true)
	r.noteMachineUse("idle-peer", measured(500))
	clearDeferredCondition(t, r)
	node.usage.Memory.CommittedMiB = 1700

	require.NoError(t, r.Reconcile(ctx, agent))
	_, stepped := r.steppedSince.Load(testOwner)
	require.False(t, stepped, "precondition: the controller's count says the grant holds the start, so no ask is stepped")
	assert.Empty(t, reclaimedAt(t, r, "idle-peer"), "the first pass of a wait frees nothing")

	backdateTheAllocationWait(t, r, agent.Name)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.NotEmpty(t, reclaimedAt(t, r, "idle-peer"),
		"the runner's own count is what refused the start, so the room is freed against it")
}

// TEST_SCENARIO: a start that stops waiting ends its clock, so the next start of the same agent waits its own grace before anything is reclaimed for it.
func TestAStartThatStopsWaitingEndsItsClock(t *testing.T) {
	_, r, _ := deferredResizeWithWaits(t, true)
	assert.False(t, r.allocationWaitSpent("my-agent", true), "the first pass of a wait has not spent a grace")
	backdateTheAllocationWait(t, r, "my-agent")
	require.True(t, r.allocationWaitSpent("my-agent", true), "precondition: a grace has passed")
	assert.False(t, r.allocationWaitSpent("my-agent", false), "a pass that finds no wait ends it")
	assert.False(t, r.allocationWaitSpent("my-agent", true), "the next wait starts its own clock")
}

func backdateTheAllocationWait(t *testing.T, r *AgentReconciler, name string) {
	t.Helper()
	_, ok := r.allocationWaits.Load(name)
	require.True(t, ok, "no wait is recorded for %s", name)
	r.allocationWaits.Store(name, time.Now().Add(-2*steppedGrantGrace))
}

func reclaimedAt(t *testing.T, r *AgentReconciler, name string) string {
	t.Helper()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(t.Context(), name, metav1.GetOptions{})
	require.NoError(t, err)
	return u.GetAnnotations()[annReclaimedAt]
}
