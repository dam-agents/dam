// TEST_OVERVIEW: the parts of a vm agent's life that happen around its reconcile rather than in it: cleaning up after a deleted Agent, which has to reach the owner's runner and may have to wait for it; how often an agent whose runner is not ready is looked at again; and which Agents a change to a runner Deployment wakes.
package reconciler

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"
	"strings"

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

	uid := deleteAgentCR(t, r, "my-agent")
	require.Error(t, r.Delete(ctx, "my-agent", testOwner, uid))
	assert.Empty(t, node.deleted)

	r.runnerEndpoint = reachable
	r.runnerMu.Lock()
	r.runners = nil
	r.runnerMu.Unlock()
	require.NoError(t, r.Delete(ctx, "my-agent", testOwner, uid))
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

// TEST_SCENARIO: an idle vm agent is hibernated while its owner's runner cannot be reached. The machine cannot be stopped yet, but that is no reason to keep its gateway up or the agent reported ready: the gateway is scaled down and readiness goes down. The agent must not read hibernated while its machine may still run, because the api-server trusts a health check answer on a wake from hibernation, and an old guest still running would answer it.
func TestHibernatingWhileTheRunnerIsUnreachableScalesDownButDoesNotPublishHibernation(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	require.NoError(t, updateAgentStatus(ctx, r.dynamic, "test-agents", "my-agent", func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReady, true, "AllPodsReady", "", "", 0)
	}))
	unreachable := func(context.Context, string, string) error { return errors.New("the VM runner could not be reached") }

	_, err := hibernateAgentPair(ctx, r.client, r.dynamic, unreachable, testOwner, "test-agents", "my-agent")
	require.Error(t, err)

	assert.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("my-agent")))
	ready := readyCondition(t, r, "my-agent")
	assert.Equal(t, metav1.ConditionFalse, ready.Status)
	assert.NotEqual(t, apiv1.ReasonHibernated, ready.Reason)
	reason, msg := agentPodReadyMessage(t, r, "my-agent")
	assert.NotEqual(t, apiv1.ReasonHibernated, reason)
	assert.Contains(t, msg, "the machine has not stopped yet")
}

// TEST_SCENARIO: the idle checker could not stop an idle vm agent's machine because its runner was unreachable. That must not wedge the agent short of hibernation: the next sweep tries again, and once the runner answers, the machine stops and hibernation is published.
func TestTheIdleCheckerRetriesAHibernationWhoseMachineDidNotStop(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	require.True(t, node.spec("my-agent").Running)
	stored, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	stored.SetAnnotations(map[string]string{annLastActivity: time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)})
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, stored, metav1.UpdateOptions{})
	require.NoError(t, err)

	reachable := false
	checker := NewIdleChecker(r.client, r.dynamic, r.config).WithMachineHalt(func(ctx context.Context, owner, name string) error {
		if !reachable {
			return errors.New("the VM runner could not be reached")
		}
		return r.HaltMachine(ctx, owner, name)
	})
	checker.busyProbe = func(context.Context, string) bool { return false }

	checker.check(ctx)
	assert.NotEqual(t, apiv1.ReasonHibernated, readyCondition(t, r, "my-agent").Reason)
	assert.True(t, node.spec("my-agent").Running)

	reachable = true
	checker.check(ctx)
	assert.Equal(t, apiv1.ReasonHibernated, readyCondition(t, r, "my-agent").Reason)
	assert.False(t, node.spec("my-agent").Running)
}

// TEST_SCENARIO: the runner answers a stop at once, while the guest is still being signalled, quiesced and powered off. A wake in those seconds would trust the first health check answer if the agent read hibernated, and the guest about to power off would give it. So the agent reads hibernated only once the runner reports the machine stopped, reads as stopping until then, and its reconcile watches the machine.
func TestAnAgentReadsHibernatedOnlyOnceItsMachineHasStopped(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	agent.Annotations[annLastActivity] = time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	stored, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	stored.SetAnnotations(agent.Annotations)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, stored, metav1.UpdateOptions{})
	require.NoError(t, err)
	node.mu.Lock()
	node.stopsSlowly = true
	node.mu.Unlock()
	checker := NewIdleChecker(r.client, r.dynamic, r.config).WithMachineHalt(r.HaltMachine)
	checker.busyProbe = func(context.Context, string) bool { return false }

	checker.check(ctx)
	require.False(t, node.spec("my-agent").Running)
	assert.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("my-agent")))
	assert.NotEqual(t, apiv1.ReasonHibernated, readyCondition(t, r, "my-agent").Reason)
	stored, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	stopping, err := FromCacheObject[apiv1.Agent](stored)
	require.NoError(t, err)
	assert.Equal(t, apiv1.ReasonMachineStopping, apimeta.FindStatusCondition(stopping.Status.Conditions, apiv1.ConditionAgentPodReady).Reason, "the agent reads as stopping, not as starting")
	assert.True(t, r.watchingMachine("my-agent"), "the stopping machine is watched")

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.NotEqual(t, apiv1.ReasonHibernated, readyCondition(t, r, "my-agent").Reason)
	assert.True(t, r.watchingMachine("my-agent"))

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, apiv1.ReasonHibernated, readyCondition(t, r, "my-agent").Reason)
	assert.False(t, r.watchingMachine("my-agent"))
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

// TEST_SCENARIO: an owner's first vm agent dials a runner that has just become ready, before its headless Service's name resolves. The agent waits on the runner as one still starting, with no reconcile error, so it is not shown as failed, and is looked at again after three seconds.
func TestARunnerWhoseAddressDoesNotResolveYetIsStillStarting(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, requeued := setupVMReconciler(t, agent)
	runner, err := r.runnerFor(ctx, testOwner)
	require.NoError(t, err)
	runner.HTTP.Transport = &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) {
		return nil, &net.DNSError{Err: "no such host", Name: r.runnerHost(testOwner), IsNotFound: true}
	}}

	require.NoError(t, r.Reconcile(ctx, agent))

	reconciled, _ := agentCondition(t, r, "my-agent", apiv1.ConditionReconciled)
	assert.NotEqual(t, "False", reconciled)
	_, msg := agentPodReadyMessage(t, r, "my-agent")
	assert.Equal(t, "the owner's VM runner is still starting: its address does not resolve yet", msg)
	assert.Equal(t, "3s", requeued.last().String())
}
