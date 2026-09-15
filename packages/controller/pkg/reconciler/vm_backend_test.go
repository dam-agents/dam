// TEST_OVERVIEW: the vm backend runs the agent as a persistent machine on the VM runner instead of a StatefulSet. The controller must hand the node everything the guest needs to be a platform agent (the gateway proxy env, the MITM CA, the persisted paths, an egress allowlist of exactly the paired gateway), publish the machine into the cluster as the agent Service so the api-server dials it like a pod, mirror the machine's readiness onto the Agent status, stop the machine when the agent should not run, and delete it with the agent.
package reconciler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/vmrunner"
)

type fakeNode struct {
	mu       sync.Mutex
	specs    map[string]vmrunner.MachineSpec
	statuses map[string]vmrunner.MachineStatus
	deleted  []string
}

func newFakeNode(t *testing.T) (*fakeNode, *httptest.Server) {
	n := &fakeNode{specs: map[string]vmrunner.MachineSpec{}, statuses: map[string]vmrunner.MachineStatus{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer node-token" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id := r.URL.Path[len("/machines/"):]
		n.mu.Lock()
		defer n.mu.Unlock()
		switch r.Method {
		case http.MethodPut:
			var spec vmrunner.MachineSpec
			require.NoError(t, json.NewDecoder(r.Body).Decode(&spec))
			n.specs[id] = spec
			st, ok := n.statuses[id]
			if !ok {
				st = vmrunner.MachineStatus{State: vmrunner.StateCreating, Port: 31000}
				n.statuses[id] = st
			}
			require.NoError(t, json.NewEncoder(w).Encode(st))
		case http.MethodDelete:
			n.deleted = append(n.deleted, id)
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	t.Cleanup(srv.Close)
	return n, srv
}

func (n *fakeNode) set(id string, st vmrunner.MachineStatus) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.statuses[id] = st
}

func (n *fakeNode) spec(id string) vmrunner.MachineSpec {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.specs[id]
}

func vmAgentCR() *apiv1.Agent {
	agent := agentCR()
	agent.Spec.Backend = &apiv1.Backend{Type: "vm"}
	agent.Spec.Image = "quay.io/example/claude-code-vm:1"
	agent.Spec.Resources.Limits = map[string]string{"cpu": "1500m", "memory": "3Gi"}
	agent.Annotations = map[string]string{annLastActivity: time.Now().UTC().Format(time.RFC3339), annRollRev: "7"}
	return agent
}

func leafSecret() *corev1.Secret {
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: EnvoyLeafSecretName("my-agent"), Namespace: "test-agents"},
		Data:       map[string][]byte{"ca.crt": []byte("MITM-CA")},
	}
}

func setupVMReconciler(t *testing.T, agent *apiv1.Agent) (*AgentReconciler, *fakeNode, *[]string) {
	t.Helper()
	node, srv := newFakeNode(t)
	r, _ := setupReconciler(t, agent, leafSecret())
	r.config.VM = config.VMConfig{Enabled: true, RunnerURL: srv.URL, RunnerAddress: "192.168.104.5", RunnerToken: "node-token"}
	r.config.AgentTemplateDefaults.Mounts = []config.Mount{{Path: "/home/agent", Persist: true, Size: "5Gi"}, {Path: "/scratch"}}
	nodeClient, _ := vmrunner.NewClient(srv.URL, "node-token", "")
	r.WithVMRunner(nodeClient)
	var requeued []string
	r.WithRequeue(func(name string, _ time.Duration) { requeued = append(requeued, name) })
	return r, node, &requeued
}

// TEST_SCENARIO: a vm agent wakes: the node gets a running machine shaped by the agent's size and mounts, wired to its gateway alone and carrying the restart revision; the cluster gets a selector-less agent Service backed by the node's published port and no agent StatefulSet; the Agent reads not-ready until the guest answers, and the reconciler polls for that itself since no pod event will come.
func TestVMBackendRunsAMachineOnTheSandboxNode(t *testing.T) {
	agent := vmAgentCR()
	r, node, requeued := setupVMReconciler(t, agent)
	ctx := context.Background()
	require.NoError(t, r.Reconcile(ctx, agent))

	spec := node.spec("my-agent")
	assert.True(t, spec.Running)
	assert.Equal(t, "quay.io/example/claude-code-vm:1", spec.Image)
	assert.Equal(t, 2, spec.CPUs)
	assert.Equal(t, 3072, spec.MemoryMiB)
	assert.Equal(t, 10, spec.StorageGiB)
	assert.Equal(t, "MITM-CA", spec.CACert)
	assert.Equal(t, []string{"10.96.42.42/32"}, spec.AllowCIDRs)
	assert.Equal(t, "http://10.96.42.42:10000", spec.Env["HTTPS_PROXY"])
	assert.Equal(t, "1", spec.Env["IS_SANDBOX"])
	assert.Equal(t, "/home/agent", spec.Env[vmPersistPathsEnv])
	assert.Equal(t, "7", spec.Revision, "the restart verb's roll revision reaches the machine")
	assert.Equal(t, "my-agent", spec.Env["PLATFORM_AGENT_ID"])

	_, err := r.client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	assert.True(t, err != nil, "no agent StatefulSet for a vm agent")
	_, err = r.client.AppsV1().StatefulSets("test-agents").Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "the paired gateway is unchanged")

	svc, err := r.client.CoreV1().Services("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Nil(t, svc.Spec.Selector)
	assert.NotEqual(t, corev1.ClusterIPNone, svc.Spec.ClusterIP)
	eps, err := r.client.DiscoveryV1().EndpointSlices("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, []string{"192.168.104.5"}, eps.Endpoints[0].Addresses)
	assert.Equal(t, int32(31000), *eps.Ports[0].Port)
	assert.Equal(t, "my-agent", eps.Labels["kubernetes.io/service-name"])

	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, metav1.ConditionFalse, cond.Status)
	assert.Equal(t, []string{"my-agent"}, *requeued)

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
	markGatewayReady(t, r)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, metav1.ConditionTrue, readyCondition(t, r, "my-agent").Status)
	assert.Len(t, *requeued, 1, "a ready machine needs no poll")
}

func markGatewayReady(t *testing.T, r *AgentReconciler) {
	t.Helper()
	ctx := context.Background()
	ss, err := r.client.AppsV1().StatefulSets("test-agents").Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	ss.Status.ObservedGeneration = ss.Generation
	ss.Status.UpdateRevision = "rev-1"
	_, err = r.client.AppsV1().StatefulSets("test-agents").UpdateStatus(ctx, ss, metav1.UpdateOptions{})
	require.NoError(t, err)
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: GatewayName("my-agent") + "-0", Namespace: "test-agents",
			Labels: map[string]string{"controller-revision-hash": "rev-1"}},
		Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}},
	}
	_, err = r.client.CoreV1().Pods("test-agents").Create(ctx, pod, metav1.CreateOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: a hard stop must reach the machine: the node is told the machine should not run, and the gateway pair scales down as for any agent.
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

// TEST_SCENARIO: deleting the Agent deletes the machine and its disk on the node — the only place a vm agent's workspace lives.
func TestVMBackendDeleteRemovesTheMachine(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.Delete(context.Background(), "my-agent")
	assert.Equal(t, []string{"my-agent"}, node.deleted)
}

// TEST_SCENARIO: the guest's MITM CA comes from the same leaf Secret the pod mounts; until cert-manager issues it there is nothing to boot with, so the reconcile requeues instead of creating a machine that cannot trust its gateway.
func TestVMBackendWaitsForTheLeafSecret(t *testing.T) {
	agent := vmAgentCR()
	node, srv := newFakeNode(t)
	r, _ := setupReconciler(t, agent)
	r.config.VM = config.VMConfig{Enabled: true, RunnerURL: srv.URL, RunnerAddress: "192.168.104.5", RunnerToken: "node-token"}
	nodeClient2, _ := vmrunner.NewClient(srv.URL, "node-token", "")
	r.WithVMRunner(nodeClient2)
	err := r.Reconcile(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not yet issued")
	assert.Empty(t, node.specs)
}

// TEST_SCENARIO: an install without a VM runner cannot run vm agents; the Agent says so instead of silently running as a container.
func TestVMBackendDisabledFailsReconcile(t *testing.T) {
	agent := vmAgentCR()
	r, _ := setupReconciler(t, agent)
	err := r.Reconcile(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "virtualization is disabled")
}
