// TEST_OVERVIEW: the parts of a vm agent's life that happen around its reconcile rather than in it: cleaning up after a deleted Agent, which has to reach the owner's runner and may have to wait for it; how often an agent whose runner is not ready is looked at again; and which Agents a change to a runner Deployment wakes.
package reconciler

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/cache"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// TEST_SCENARIO: an Agent is deleted while its owner's runner is restarting. The machine cannot be removed yet, so the cleanup says so — the delete queue retries it — and a later attempt, with the runner back, removes it.
func TestADeleteThatCannotReachTheRunnerIsRetried(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	reachable := r.runnerEndpoint
	gone := httptest.NewServer(nil)
	gone.Close()
	r.runnerEndpoint = func(string) string { return gone.URL }
	r.runnerMu.Lock()
	r.runners = nil
	r.runnerMu.Unlock()

	require.Error(t, r.Delete(ctx, "my-agent", testOwner))
	assert.Empty(t, node.deleted)

	r.runnerEndpoint = reachable
	r.runnerMu.Lock()
	r.runners = nil
	r.runnerMu.Unlock()
	require.NoError(t, r.Delete(ctx, "my-agent", testOwner))
	assert.Equal(t, []string{"my-agent"}, node.deleted)
}

// TEST_SCENARIO: the owner's runner is not ready and stays that way. Each reconcile of the agent asks to be looked at again later than the last, from three seconds up to a minute, and a runner that answers puts the agent back on the ordinary health poll.
func TestAnAgentWaitingForItsRunnerBacksOff(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, requeued := setupVMReconciler(t, agent)
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Status.ReadyReplicas = 0
	_, err = r.client.AppsV1().Deployments("test-agents").UpdateStatus(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)

	var polls []string
	for range 7 {
		require.NoError(t, r.Reconcile(ctx, agent))
		polls = append(polls, requeued.last().String())
	}
	assert.Equal(t, []string{"3s", "6s", "12s", "24s", "48s", "1m0s", "1m0s"}, polls)

	dep, err = r.client.AppsV1().Deployments("test-agents").Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Status.ReadyReplicas = 1
	_, err = r.client.AppsV1().Deployments("test-agents").UpdateStatus(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, vmHealthPoll, requeued.last())
	_, backingOff := r.notReadyPolls.Load("my-agent")
	assert.False(t, backingOff, "a reached runner resets the backoff")
}

// TEST_SCENARIO: a runner Deployment changed — its pod became ready. Its owner's vm agents are the ones waiting on it; the owner's container agents and other owners' agents are not woken.
func TestARunnerChangeWakesOnlyItsOwnersVMAgents(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	add := func(name, owner string, vm bool) {
		a := vmAgentCR()
		a.Name = name
		a.Labels = map[string]string{envoyOwnerLabel: owner}
		if !vm {
			a.Spec.Backend = nil
		}
		u, err := agentToUnstructured(a)
		require.NoError(t, err)
		require.NoError(t, indexer.Add(u))
	}
	add("vm-one", testOwner, true)
	add("container-one", testOwner, false)
	add("vm-other", "someone-else", true)
	r.WithAgentCache(cache.NewGenericLister(indexer, schema.GroupResource{Group: AgentsGVR.Group, Resource: AgentsGVR.Resource}))

	assert.Equal(t, []string{"vm-one"}, r.OwnerVMAgents(testOwner))
	assert.Empty(t, r.OwnerVMAgents(""))
}

func addVMPeer(t *testing.T, r *AgentReconciler, name string, running bool) *apiv1.Agent {
	t.Helper()
	ctx := context.Background()
	a := vmAgentCR()
	a.Name = name
	a.Labels = map[string]string{envoyOwnerLabel: testOwner}
	a.Spec.Resources.Limits = map[string]string{"cpu": "500m", "memory": "1Gi"}
	if !running {
		a.Annotations[annLastActivity] = time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	}
	u, err := agentToUnstructured(a)
	require.NoError(t, err)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, u, metav1.CreateOptions{})
	require.NoError(t, err)
	leaf := leafSecret()
	leaf.Name = EnvoyLeafSecretName(name)
	_, err = r.client.CoreV1().Secrets("test-agents").Create(ctx, leaf, metav1.CreateOptions{})
	require.NoError(t, err)
	return a
}

func rotateMITMCA(t *testing.T, r *AgentReconciler, names ...string) {
	t.Helper()
	for _, name := range names {
		sec, err := r.client.CoreV1().Secrets("test-agents").Get(context.Background(), EnvoyLeafSecretName(name), metav1.GetOptions{})
		require.NoError(t, err)
		sec.Data["ca.crt"] = []byte("MITM-CA-2")
		_, err = r.client.CoreV1().Secrets("test-agents").Update(context.Background(), sec, metav1.UpdateOptions{})
		require.NoError(t, err)
	}
}

// TEST_SCENARIO: the MITM CA rotates, which reaches every agent's leaf Secret, and the runner applies a new CA as a reboot. Two running machines take it one after the other — the second keeps the CA it runs with until the first is ready again — while a stopped machine, which reboots anyway when it starts, takes it at once.
func TestANewMITMCARebootsRunningMachinesOneAtATime(t *testing.T) {
	ctx := context.Background()
	first := vmAgentCR()
	first.Spec.Resources.Limits = map[string]string{"cpu": "500m", "memory": "1Gi"}
	r, node, _ := setupVMReconciler(t, first)
	second := addVMPeer(t, r, "second", true)
	asleep := addVMPeer(t, r, "asleep", false)
	for _, a := range []*apiv1.Agent{first, second, asleep} {
		require.NoError(t, r.Reconcile(ctx, a))
	}
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	node.set("second", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31001})
	rotateMITMCA(t, r, "my-agent", "second", "asleep")

	for _, a := range []*apiv1.Agent{first, second, asleep} {
		require.NoError(t, r.Reconcile(ctx, a))
	}
	assert.Equal(t, "MITM-CA-2", node.spec("my-agent").CACert)
	assert.Equal(t, "MITM-CA", node.spec("second").CACert, "the second running machine waits for the first to reboot")
	assert.Equal(t, "MITM-CA-2", node.spec("asleep").CACert, "a stopped machine takes the new CA at once")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, first))
	require.NoError(t, r.Reconcile(ctx, second))
	assert.Equal(t, "MITM-CA-2", node.spec("second").CACert, "once the first is back, the second takes its turn")
}

// TEST_SCENARIO: an idle vm agent is hibernated while its owner's runner cannot be reached. The machine cannot be stopped yet, but that is no reason to keep its gateway up and the agent reported as running: the gateway is scaled down and the agent reads hibernated, and the agent's next reconcile stops the machine.
func TestHibernatingWhileTheRunnerIsUnreachableStillScalesTheGatewayDown(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	unreachable := func(context.Context, string, string) error { return errors.New("the VM runner could not be reached") }

	require.NoError(t, hibernateAgentPair(ctx, r.client, r.dynamic, unreachable, testOwner, "test-agents", "my-agent"))

	assert.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("my-agent")))
	reason, _ := agentPodReadyMessage(t, r, "my-agent")
	assert.Equal(t, apiv1.ReasonHibernated, reason)
}
