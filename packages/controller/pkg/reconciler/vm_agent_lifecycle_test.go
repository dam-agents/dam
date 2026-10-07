// TEST_OVERVIEW: the parts of a vm agent's life that happen around its reconcile rather than in it: cleaning up after a deleted Agent, which has to reach the owner's runner and may have to wait for it; how often an agent whose runner is not ready is looked at again; and which Agents a change to a runner Deployment wakes.
package reconciler

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"
	"strings"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
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

// TEST_SCENARIO: cert-manager cannot issue the owner's runner certificate — its issuer is missing. The agent cannot start until it does, and cert-manager says why only on the Certificate, so the Agent's readiness carries that account instead of a status that never moves.
func TestAWaitForTheRunnerCertificateSaysWhatCertManagerSays(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	require.NoError(t, r.client.CoreV1().Secrets("test-agents").Delete(ctx, r.runnerTLSName(testOwner), metav1.DeleteOptions{}))
	dyn := r.dynamic.(interface {
		PrependReactor(verb, resource string, reaction k8stesting.ReactionFunc)
	})
	dyn.PrependReactor("get", "certificates", func(action k8stesting.Action) (bool, runtime.Object, error) {
		if action.(k8stesting.GetAction).GetName() != r.runnerTLSName(testOwner) {
			return false, nil, nil
		}
		cert := &unstructured.Unstructured{Object: map[string]interface{}{
			"apiVersion": "cert-manager.io/v1", "kind": "Certificate",
			"metadata": map[string]interface{}{"name": r.runnerTLSName(testOwner), "namespace": "test-agents", "resourceVersion": "1"},
			"status": map[string]interface{}{"conditions": []interface{}{map[string]interface{}{
				"type": "Ready", "status": "False", "message": `Issuer "platform-vm-runner-ca" not found`,
			}}},
		}}
		return true, cert, nil
	})

	require.Error(t, r.Reconcile(ctx, agent), "the reconcile still asks to be retried")

	_, msg := agentPodReadyMessage(t, r, "my-agent")
	assert.Contains(t, msg, "waiting for cert-manager to issue the owner's VM runner's TLS certificate")
	assert.Contains(t, msg, `Issuer "platform-vm-runner-ca" not found`)
}

// TEST_SCENARIO: an agent that was ready fails its next reconcile because its runner cannot be reached. Its status must not keep saying ready, and what it says instead names the failure without the runner's in-cluster address.
func TestAFailedEnsureTakesReadinessDown(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, updateAgentStatus(ctx, r.dynamic, "test-agents", "my-agent", func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionAgentPodReady, true, "PodReady", "", "", 0)
		setStatusCondition(s, apiv1.ConditionReady, true, "AllPodsReady", "", "", 0)
	}))
	gone := httptest.NewServer(nil)
	gone.Close()
	r.runnerEndpoint = func(string) string { return gone.URL }

	require.Error(t, r.Reconcile(ctx, agent))

	st, ok := agentCondition(t, r, "my-agent", apiv1.ConditionReady)
	require.True(t, ok)
	assert.Equal(t, "False", st)
	_, msg := agentPodReadyMessage(t, r, "my-agent")
	assert.Contains(t, msg, "could not be reached")
	assert.NotContains(t, msg, strings.TrimPrefix(gone.URL, "http://"))
}

// TEST_SCENARIO: an owner's disks outgrow runner.storage. The claim is capped at the ceiling — the install's choice — and that is said once for the owner, not on every reconcile of every agent they have.
func TestACappedClaimIsReportedOncePerOwner(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	big := runnerDemand{diskGiB: 500, machines: 5}
	for range 3 {
		size, ceiling, err := r.runnerClaimSize(testOwner, big)
		require.NoError(t, err)
		assert.Equal(t, 0, size.Cmp(ceiling))
	}
	notices := 0
	r.claimCapNotices.Range(func(any, any) bool { notices++; return true })
	assert.Equal(t, 1, notices)
}
