// TEST_OVERVIEW: a machine stops when the Agent should not run, and is deleted with the Agent, but only from the runner that owns it and only when no Agent of that owner claims it.
package reconciler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"

	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func TestVMBackendStopsTheMachineOnHardStop(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	ctx := context.Background()
	require.NoError(t, r.Reconcile(ctx, agent))
	require.True(t, node.spec("my-agent").Running)

	agent.Annotations[annStopRequested] = time.Now().UTC().Format(time.RFC3339)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.False(t, node.spec("my-agent").Running)
	assert.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("my-agent")))
}

func TestVMBackendDeleteRemovesTheMachine(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.Delete(context.Background(), "my-agent", AgentOwner(agent.Labels), deleteAgentCR(t, r, "my-agent"))
	assert.Equal(t, []string{"my-agent"}, node.deleted)
}

func TestADeleteNeverRemovesWhatAnAgentCreatedSinceOwns(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	require.Contains(t, node.specs, "my-agent")

	require.Error(t, r.Delete(ctx, "my-agent", AgentOwner(agent.Labels), "agent-uid"),
		"the Agent the cleanup is for is still there, so the cleanup waits")
	assert.Empty(t, node.deleted)

	require.NoError(t, r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Delete(ctx, "my-agent", metav1.DeleteOptions{}))
	recreated := vmAgentCR()
	recreated.UID = "agent-uid-2"
	u, err := agentToUnstructured(recreated)
	require.NoError(t, err)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, u, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Delete(ctx, "my-agent", AgentOwner(agent.Labels), "agent-uid"))
	assert.Empty(t, node.deleted, "the machine of the Agent created since is left alone")
}

func TestADeleteReachesOnlyTheOwnersRunner(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	other := addRunner(t, r, "owner-b")

	r.Delete(ctx, "my-agent", AgentOwner(agent.Labels), deleteAgentCR(t, r, "my-agent"))
	assert.Equal(t, []string{"my-agent"}, node.deleted)
	assert.Empty(t, other.deleted, "another owner's runner is not asked about this Agent's machine")

	r.Delete(ctx, "no-runner-agent", "owner-without-runner", types.UID("never-existed"))
	_, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, r.runnerName("owner-without-runner"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "a delete does not mint credentials for a runner that does not exist")
}

func TestADeleteWithNoOwnerReachesEveryRunner(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	other := addRunner(t, r, "owner-b")

	r.Delete(context.Background(), "my-agent", "", deleteAgentCR(t, r, "my-agent"))
	assert.Equal(t, []string{"my-agent"}, node.deleted)
	assert.Equal(t, []string{"my-agent"}, other.deleted)
}

func TestAHungRunnerHoldsUpNoOtherOwnersReconcile(t *testing.T) {
	ctx := context.Background()
	stuck := vmAgentCR()
	r, _, _ := setupVMReconciler(t, stuck)
	addRunner(t, r, "owner-b")
	woken := vmAgentCR()
	woken.Name = "woken-agent"
	woken.Labels = map[string]string{envoyOwnerLabel: "owner-b"}
	u, err := agentToUnstructured(woken)
	require.NoError(t, err)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, u, metav1.CreateOptions{})
	require.NoError(t, err)
	leaf := leafSecret()
	leaf.Name = EnvoyLeafSecretName(woken.Name)
	_, err = r.client.CoreV1().Secrets("test-agents").Create(ctx, leaf, metav1.CreateOptions{})
	require.NoError(t, err)
	pod := readyRunnerPod()
	pod.Name, pod.Labels = r.runnerName("owner-b")+"-pinned", vmRunnerSelector("owner-b")
	_, err = r.client.CoreV1().Pods("test-agents").Create(ctx, pod, metav1.CreateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, woken))

	entered, release := make(chan struct{}, 1), make(chan struct{})
	hung := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		select {
		case entered <- struct{}{}:
		default:
		}
		<-release
	}))
	t.Cleanup(hung.Close)
	reachable := r.runnerEndpoint
	r.runnerEndpoint = func(owner string) string {
		if owner == testOwner {
			return hung.URL
		}
		return reachable(owner)
	}
	done := make(chan struct{})
	go func() {
		_ = r.Reconcile(ctx, stuck)
		close(done)
	}()
	t.Cleanup(func() {
		close(release)
		<-done
	})
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the stuck owner's reconcile never called its runner")
	}

	start := time.Now()
	require.NoError(t, r.Reconcile(ctx, woken))
	assert.Less(t, time.Since(start), 2*time.Second, "another owner's reconcile waited on the hung runner")
}

func TestHaltingIsANoOpForAContainerAgent(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.Backend = nil
	r, node, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.HaltMachine(context.Background(), testOwner, "my-agent"))
	assert.Empty(t, node.specs, "a container agent must not reach its owner's runner")
}

func TestHibernatingAVMAgentStopsItsMachine(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	require.True(t, node.spec("my-agent").Running, "the machine is up before we put it to sleep")

	require.NoError(t, hibernateAgentPair(ctx, r.client, r.dynamic, r.HaltMachine, testOwner, "test-agents", "my-agent"))

	assert.False(t, node.spec("my-agent").Running, "the machine is stopped, not just the gateway scaled")
	require.NotEmpty(t, node.puts)
	assert.False(t, node.puts[len(node.puts)-1].Running, "the last thing the controller asked for is a stopped machine")
}

func TestALapsedIdleTimeoutLeavesTheMachineToTheIdleChecker(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))

	agent.Annotations[annLastActivity] = time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.True(t, node.spec("my-agent").Running, "the busy probe has not been asked yet")

	unreachable := func(context.Context, string, string) error { return errors.New("the VM runner could not be reached") }
	require.Error(t, hibernateAgentPair(ctx, r.client, r.dynamic, unreachable, testOwner, "test-agents", "my-agent"))
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.False(t, node.spec("my-agent").Running)
}

func TestOrphanSweepKeepsARunnerThatStillHoldsAMachine(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	require.NotEmpty(t, node.specs, "the machine exists on the runner")

	stored, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	unstructured.RemoveNestedField(stored.Object, "spec", "backend")
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, stored, metav1.UpdateOptions{})
	require.NoError(t, err)

	r.ReconcileOrphanMachines(ctx)

	_, err = r.client.CoreV1().PersistentVolumeClaims("test-agents").
		Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err, "the runner's disk survives a sweep that raced a machine")
}

func TestOrphanSweepDeletesAMachineNoAgentOfThisOwnerClaims(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	require.Contains(t, node.specs, "my-agent")

	node.specs["someone-elses"] = vmrunner.MachineSpec{}
	foreign := vmAgentCR()
	foreign.Name = "someone-elses"
	foreign.Labels = map[string]string{envoyOwnerLabel: "another-owner"}
	u, err := agentToUnstructured(foreign)
	require.NoError(t, err)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, u, metav1.CreateOptions{})
	require.NoError(t, err)

	r.ReconcileOrphanMachines(ctx)
	assert.Empty(t, node.deleted, "a machine one sweep finds unclaimed waits the grace")

	r.orphanMachines.Store(testOwner+"/someone-elses", time.Now().Add(-orphanGrace-time.Minute))
	r.ReconcileOrphanMachines(ctx)

	assert.Equal(t, []string{"someone-elses"}, node.deleted,
		"the machine whose Agent belongs to another owner is collected, and this owner's own machine is left alone")
}
