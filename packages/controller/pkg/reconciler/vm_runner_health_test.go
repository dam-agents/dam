// TEST_OVERVIEW: the runner health gauges say, across the whole install and without naming any owner, how many machines should run and how many answer, how many runners fall short, how the roll is getting on, and how many runner pods a node has not resized.
package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TEST_SCENARIO: two owners want three machines running between them; one of the first owner's has not answered, and a stopped machine counts for neither side. Only the first owner's runner is short, and a deleted agent stops counting.
func TestRunnerHealthCountsMachinesAcrossOwners(t *testing.T) {
	ctx := context.Background()
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	r.machineSeen.Store("a1", machineSeen{owner: "owner-a", desired: true, up: true})
	r.machineSeen.Store("a2", machineSeen{owner: "owner-a", desired: true})
	r.machineSeen.Store("a3", machineSeen{owner: "owner-a"})
	r.machineSeen.Store("b1", machineSeen{owner: "owner-b", desired: true, up: true})

	r.ReconcileRunnerHealth(ctx)
	h := r.RunnerHealth()
	assert.Equal(t, int64(3), h.MachinesDesired)
	assert.Equal(t, int64(2), h.MachinesUp)
	assert.Equal(t, int64(1), h.RunnersShort)

	require.NoError(t, r.Delete(ctx, "a2", "owner-a"))
	r.ReconcileRunnerHealth(ctx)
	assert.Equal(t, int64(0), r.RunnerHealth().RunnersShort)
}

// TEST_SCENARIO: a runner whose pod changed while the roll was full is counted as waiting, with how long it has waited, and one that has gone since is forgotten. A stalled roll is counted from the mark the roll left on its runner.
func TestRunnerHealthReadsTheRoll(t *testing.T) {
	ctx := context.Background()
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	r.rollWaiting.Store(r.runnerName(testOwner), time.Now().Add(-time.Hour))
	r.rollWaiting.Store("platform-vm-runner-gone", time.Now().Add(-2*time.Hour))
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Annotations = map[string]string{annRunnerStalled: time.Now().UTC().Format(time.RFC3339)}
	_, err = r.client.AppsV1().Deployments("test-agents").Update(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)

	r.ReconcileRunnerHealth(ctx)
	h := r.RunnerHealth()
	assert.Equal(t, int64(1), h.RollsWaiting)
	assert.InDelta(t, time.Hour.Seconds(), h.RollWaitOldest, 60)
	assert.Equal(t, int64(1), h.RollsStalled)
	_, stillThere := r.rollWaiting.Load("platform-vm-runner-gone")
	assert.False(t, stillThere)
}

// TEST_SCENARIO: a runner pod whose memory resize the node deferred is counted by the node's reason, and a reason the controller does not know is counted apart so a label never takes a value from outside a fixed set.
func TestRunnerHealthCountsDeferredResizes(t *testing.T) {
	ctx := context.Background()
	r, _, _ := setupVMReconciler(t, vmAgentCR())
	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, readyRunnerPod().Name, metav1.GetOptions{})
	require.NoError(t, err)
	pod.Labels["app.kubernetes.io/component"] = vmRunnerComponent
	pod.Status.Conditions = append(pod.Status.Conditions, corev1.PodCondition{Type: corev1.PodResizePending, Status: corev1.ConditionTrue, Reason: corev1.PodReasonDeferred})
	_, err = r.client.CoreV1().Pods("test-agents").Update(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)

	r.ReconcileRunnerHealth(ctx)
	assert.Equal(t, map[string]int64{corev1.PodReasonDeferred: 1}, r.RunnerHealth().ResizePending)
	assert.Equal(t, "Other", resizeReasonLabel("SomethingNew"))
}
