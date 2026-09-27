// TEST_OVERVIEW: the parts of a vm agent's life that happen around its reconcile rather than in it: cleaning up after a deleted Agent, which has to reach the owner's runner and may have to wait for it; how often an agent whose runner is not ready is looked at again; and which Agents a change to a runner Deployment wakes.
package reconciler

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/cache"
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
