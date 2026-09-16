// TEST_OVERVIEW: the vm backend runs the agent as a persistent machine on the VM runner instead of a StatefulSet. The controller must hand the node everything the guest needs to be a platform agent (the gateway proxy env, the MITM CA, the persisted paths, an egress allowlist of exactly the paired gateway), publish the machine into the cluster as the agent Service so the api-server dials it like a pod, mirror the machine's readiness onto the Agent status, stop the machine when the agent should not run, and delete it with the agent.
package reconciler

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/vmrunner"
)

type fakeNode struct {
	mu       sync.Mutex
	specs    map[string]vmrunner.MachineSpec
	statuses map[string]vmrunner.MachineStatus
	deleted  []string
	puts     []vmrunner.MachineSpec
}

func newFakeNode(t *testing.T) (*fakeNode, *httptest.Server) {
	n := &fakeNode{specs: map[string]vmrunner.MachineSpec{}, statuses: map[string]vmrunner.MachineStatus{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer node-token" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		n.mu.Lock()
		defer n.mu.Unlock()
		if r.URL.Path == "/machines" {
			ids := []string{}
			for id := range n.specs {
				ids = append(ids, id)
			}
			require.NoError(t, json.NewEncoder(w).Encode(ids))
			return
		}
		id := r.URL.Path[len("/machines/"):]
		switch r.Method {
		case http.MethodPut:
			var spec vmrunner.MachineSpec
			require.NoError(t, json.NewDecoder(r.Body).Decode(&spec))
			n.specs[id] = spec
			n.puts = append(n.puts, spec)
			st, ok := n.statuses[id]
			if !ok {
				st = vmrunner.MachineStatus{State: vmrunner.StateCreating, Port: 31000}
				n.statuses[id] = st
			}
			require.NoError(t, json.NewEncoder(w).Encode(st))
		case http.MethodGet:
			require.NoError(t, json.NewEncoder(w).Encode(n.statuses[id]))
		case http.MethodDelete:
			n.deleted = append(n.deleted, id)
			delete(n.specs, id)
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

const testOwner = "owner-1"

// UNIT_BOUNDARY_DESCRIPTION: the controller creates an owner's runner itself, so the tests hand it one already reporting a ready pod — the creating path is the same code with an empty cluster.
func runnerSecret() *corev1.Secret {
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner-" + runnerSuffix(testOwner), Namespace: "default"},
		Data:       map[string][]byte{"token": []byte("node-token")},
	}
}

func readyRunnerDeployment() *appsv1.Deployment {
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "platform-vm-runner-" + runnerSuffix(testOwner),
			Namespace: "default",
			Labels:    map[string]string{"app.kubernetes.io/component": vmRunnerComponent, envoyOwnerLabel: testOwner},
		},
		Status: appsv1.DeploymentStatus{ReadyReplicas: 1},
	}
}

func leafSecret() *corev1.Secret {
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: EnvoyLeafSecretName("my-agent"), Namespace: "test-agents"},
		Data:       map[string][]byte{"ca.crt": []byte("MITM-CA")},
	}
}

func setupVMReconciler(t *testing.T, agent *apiv1.Agent) (*AgentReconciler, *fakeNode, *[]time.Duration) {
	t.Helper()
	node, srv := newFakeNode(t)
	if agent.Labels == nil {
		agent.Labels = map[string]string{}
	}
	agent.Labels[envoyOwnerLabel] = testOwner
	r, _ := setupReconciler(t, agent, leafSecret(), readyRunnerDeployment(), runnerSecret())
	r.config.VM = config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{
		Image: "quay.io/dam-agents/vm-runner:1", Storage: "100Gi", ReserveMiB: 512,
	}}
	r.runnerEndpoint = func(string) string { return srv.URL }
	r.runnerIP = func(string) (string, error) { return "10.42.0.9", nil }
	var requeued []time.Duration
	r.WithRequeue(func(_ string, after time.Duration) { requeued = append(requeued, after) })
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
	assert.Equal(t, []string{"10.42.0.9"}, eps.Endpoints[0].Addresses)
	assert.Equal(t, int32(31000), *eps.Ports[0].Port)
	assert.Equal(t, "my-agent", eps.Labels["kubernetes.io/service-name"])
	require.NotNil(t, eps.Endpoints[0].Conditions.Ready)
	assert.False(t, *eps.Endpoints[0].Conditions.Ready, "a machine that is still booting takes no traffic")

	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, metav1.ConditionFalse, cond.Status)
	assert.Equal(t, []time.Duration{vmReadinessPoll}, *requeued)

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
	markGatewayReady(t, r)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, metav1.ConditionTrue, readyCondition(t, r, "my-agent").Status)
	eps, err = r.client.DiscoveryV1().EndpointSlices("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.True(t, *eps.Endpoints[0].Conditions.Ready, "a ready machine takes traffic — kube-proxy drops an endpoint that never turns ready")
	assert.Equal(t, vmHealthPoll, (*requeued)[len(*requeued)-1], "a ready machine is still polled, just slower — nothing else would notice its guest dying")
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
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	r, _ := setupReconciler(t, agent, readyRunnerDeployment(), runnerSecret())
	r.config.VM = config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{Image: "vm-runner:1", Storage: "100Gi"}}
	r.runnerEndpoint = func(string) string { return srv.URL }
	r.runnerIP = func(string) (string, error) { return "10.42.0.9", nil }
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

// TEST_SCENARIO: two owners' vm agents: each owner's machines land on a runner of their own — a separate Deployment, disk and credentials — so one owner's guest cannot reach another's, and the runner's ingress policy admits only the platform.
func TestEachOwnerGetsTheirOwnRunner(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	ctx := context.Background()

	_, _, err := r.ensureRunner(ctx, "owner-a")
	require.NoError(t, err)
	_, _, err = r.ensureRunner(ctx, "owner-b")
	require.NoError(t, err)

	a, b := r.runnerName("owner-a"), r.runnerName("owner-b")
	assert.NotEqual(t, a, b, "one runner per owner")
	for _, name := range []string{a, b} {
		dep, err := r.client.AppsV1().Deployments("default").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err)
		assert.Equal(t, int32(1), *dep.Spec.Replicas)
		pvc, err := r.client.CoreV1().PersistentVolumeClaims("default").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err)
		assert.Equal(t, "100Gi", pvc.Spec.Resources.Requests.Storage().String())
		_, err = r.client.CoreV1().Services("default").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err)
		np, err := r.client.NetworkingV1().NetworkPolicies("default").Get(ctx, name+"-ingress", metav1.GetOptions{})
		require.NoError(t, err)
		assert.Len(t, np.Spec.Ingress[0].From, 2, "only the api-server and the controller may dial a runner")
	}

	secretA, err := r.client.CoreV1().Secrets("default").Get(ctx, a, metav1.GetOptions{})
	require.NoError(t, err)
	secretB, err := r.client.CoreV1().Secrets("default").Get(ctx, b, metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEqual(t, secretA.Data["token"], secretB.Data["token"], "a runner's token is its own")
	assert.NotEmpty(t, secretA.Data["tls.crt"])

	r.deleteRunner(ctx, "owner-a")
	_, err = r.client.AppsV1().Deployments("default").Get(ctx, a, metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "an owner with no vm agents keeps no runner")
	_, err = r.client.AppsV1().Deployments("default").Get(ctx, b, metav1.GetOptions{})
	require.NoError(t, err, "and the other owner's runner is untouched")
}

// TEST_SCENARIO: an install has virtualization on but the agent hibernating is container-backed; halting must not reach a runner, because that agent has no machine and an error here would strand its credentials.
func TestHaltingIsANoOpForAContainerAgent(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.Backend = nil
	r, node, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.HaltMachine(context.Background(), testOwner, "my-agent"))
	assert.Empty(t, node.specs, "a container agent must not reach its owner's runner")
}

// TEST_SCENARIO: a persisted mount carries a size that does not parse; the reconcile fails instead of booting the guest on the 1 GiB floor, which would look healthy and run out of disk later.
func TestVMBackendRefusesAMountSizeItCannotParse(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.Mounts = []apiv1.Mount{{Path: "/home/agent", Persist: true, Size: "5GG"}}
	r, node, _ := setupVMReconciler(t, agent)

	err := r.Reconcile(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "/home/agent")
	assert.Empty(t, node.specs, "no machine is created from a spec the controller could not size")
}

// TEST_SCENARIO: the release is not called `platform`, so the chart's fullname and the Helm release name diverge; the runner's ingress policy must still select the api-server and controller pods, which carry the release name — selecting on the fullname would admit nobody and strand every vm agent.
func TestRunnerPolicyAdmitsPeersWhenTheReleaseNameDiffersFromTheFullname(t *testing.T) {
	np := buildRunnerNetworkPolicy(testOwner, "dam-platform", "dam", "default", "test-agents", nil, nil)

	var instances []string
	for _, rule := range np.Spec.Ingress {
		for _, from := range rule.From {
			instances = append(instances, from.PodSelector.MatchLabels["app.kubernetes.io/instance"])
		}
	}
	require.Len(t, instances, 2, "the api-server and the controller, and nothing else")
	for _, got := range instances {
		assert.Equal(t, "dam", got, "peers are selected by the release name the chart puts on its pods")
	}
	assert.Equal(t, "dam-platform-vm-runner-"+runnerSuffix(testOwner)+"-ingress", np.Name)
}

// TEST_SCENARIO: nothing answers the owner's machine API — the case every owner's first vm agent starts in, before its runner exists. The resize gate guards a machine that is already running, so with no such machine it must allow; refusing wedges the very reconcile that would build the runner.
func TestResizeGateAllowsWhenTheRunnerCannotBeReached(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.runnerEndpoint = func(string) string { return "https://127.0.0.1:1" }

	verdict, changed, err := r.resizeAllows(context.Background(), agent, testOwner)
	require.NoError(t, err, "an unreachable runner must not fail the reconcile")
	assert.True(t, verdict.allowed)
	assert.False(t, changed)
}

// TEST_SCENARIO: Helm never sees a runner — the controller creates it — so nothing would remove one on uninstall, on rollback, or when virtualization is switched off. Every object it creates is owned by the controller's own Deployment, so the cluster collects them all; a single object missing the reference strands a running VM and its disk.
func TestRunnerObjectsAreOwnedByTheController(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	_, err := r.client.AppsV1().Deployments("default").Create(ctx, &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-controller", Namespace: "default", UID: "controller-uid"},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	name := r.runnerName(testOwner)
	require.NoError(t, r.client.CoreV1().Secrets("default").Delete(ctx, name, metav1.DeleteOptions{}))

	require.ErrorContains(t, r.Reconcile(ctx, agent), "VM runner", "the fresh token is rejected by the fake runner, which happens after every object below exists")

	owners := map[string][]metav1.OwnerReference{}
	sec, err := r.client.CoreV1().Secrets("default").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	owners["secret"] = sec.OwnerReferences
	pvc, err := r.client.CoreV1().PersistentVolumeClaims("default").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	owners["pvc"] = pvc.OwnerReferences
	svc, err := r.client.CoreV1().Services("default").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	owners["service"] = svc.OwnerReferences
	np, err := r.client.NetworkingV1().NetworkPolicies("default").Get(ctx, name+"-ingress", metav1.GetOptions{})
	require.NoError(t, err)
	owners["networkpolicy"] = np.OwnerReferences
	dep, err := r.client.AppsV1().Deployments("default").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	owners["deployment"] = dep.OwnerReferences

	for kind, refs := range owners {
		require.Len(t, refs, 1, "%s carries no owner, so it would outlive the release", kind)
		assert.Equal(t, types.UID("controller-uid"), refs[0].UID, "%s is owned by the controller", kind)
	}
}

// TEST_SCENARIO: the owner's Agents no longer look like vm agents, yet a machine is still running on their runner. Deleting the runner takes that owner's whole disk with it, so it is re-read first and kept while it still holds anything.
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

	_, err = r.client.CoreV1().PersistentVolumeClaims("default").
		Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err, "the runner's disk survives a sweep that raced a machine")
}

// TEST_SCENARIO: a runner built before the controller owned its objects; the Secret, PVC and Service are created once and never re-applied, so an upgrade would leave exactly the objects holding that owner's disk and credentials with no owner, and uninstall would strand them.
func TestRunnerObjectsCreatedBeforeOwnershipAreAdopted(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	_, err := r.client.AppsV1().Deployments("default").Create(ctx, &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-controller", Namespace: "default", UID: "controller-uid"},
	}, metav1.CreateOptions{})
	require.NoError(t, err)

	name := r.runnerName(testOwner)
	sec, err := r.client.CoreV1().Secrets("default").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	require.Empty(t, sec.OwnerReferences, "the harness seeds it the way an older controller left it")

	require.NoError(t, r.Reconcile(ctx, agent))

	sec, err = r.client.CoreV1().Secrets("default").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, sec.OwnerReferences, 1, "the existing Secret is adopted")
	assert.Equal(t, types.UID("controller-uid"), sec.OwnerReferences[0].UID)
}

// TEST_SCENARIO: the runner refuses a machine for want of memory; the agent parks instead of spinning — the gateway scales to zero so the owner stops being charged for an agent that does not exist, and the status carries the runner's own explanation of what to free.
func TestARefusedMachineParksAndReleasesTheOwnersBudget(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses["my-agent"] = vmrunner.MachineStatus{
		State:   vmrunner.StateCreating,
		Reason:  vmrunner.ReasonOutOfCapacity,
		Message: "this machine's 1024 MiB does not fit",
	}

	require.NoError(t, r.Reconcile(ctx, agent))

	assert.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("my-agent")),
		"the gateway is scaled down, so the owner is not charged for a machine that was refused")
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, metav1.ConditionFalse, cond.Status)
	assert.Contains(t, cond.Message, "does not fit", "the runner's own explanation reaches the user")
}

// TEST_SCENARIO: a machine no Agent of this owner claims holds guest memory forever, so the sweep deletes it — and ownership is part of the match, because an Agent of the same name belonging to someone else says nothing about this runner's machine.
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

	assert.Equal(t, []string{"someone-elses"}, node.deleted,
		"the machine whose Agent belongs to another owner is collected, and this owner's own machine is left alone")
}

// TEST_SCENARIO: hibernating a vm agent has to stop its machine, which is how the platform reclaims a runner's memory — scaling the gateway alone would leave the guest running while the owner's budget counts that memory as free.
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

// TEST_SCENARIO: the controller trusts a runner by the certificate it minted for it, so that certificate has to name the Service the controller dials — a cert for the wrong name fails the handshake, and anything that is not a certificate at all would silently leave the connection unverified.
func TestTheRunnerCertificateNamesTheServiceTheControllerDials(t *testing.T) {
	r, _ := setupReconciler(t, vmAgentCR())
	r.config.ReleaseName = "platform"
	r.config.ReleaseNamespace = "default"
	name := r.runnerName(testOwner)

	certPEM, keyPEM, err := selfSignedCert(name, r.runnerHost(testOwner))
	require.NoError(t, err)
	require.NotEmpty(t, keyPEM)

	block, _ := pem.Decode([]byte(certPEM))
	require.NotNil(t, block, "the minted material is a PEM block")
	cert, err := x509.ParseCertificate(block.Bytes)
	require.NoError(t, err, "and it parses as a certificate")
	assert.Contains(t, cert.DNSNames, r.runnerHost(testOwner), "the cert names the Service the controller dials")
	assert.Contains(t, cert.DNSNames, name)

	_, err = vmrunner.NewClient("https://"+r.runnerHost(testOwner)+":4600", "token", certPEM)
	require.NoError(t, err, "the controller trusts what it minted")

	_, err = vmrunner.NewClient("https://x:4600", "token", "not-a-cert")
	require.Error(t, err, "and refuses to dial with something that is not a certificate")
}

// TEST_SCENARIO: an install says where its runner may go; the policy then confines the pod as well as admitting callers, which is the only kernel gate behind a guest's egress allowlist — smolvm enforces that allowlist inside the process an escaped guest would already own.
func TestRunnerPolicyConfinesTheRunnerWhenEgressIsConfigured(t *testing.T) {
	open := buildRunnerNetworkPolicy(testOwner, "platform", "platform", "default", "test-agents", nil, nil)
	assert.Equal(t, []networkingv1.PolicyType{networkingv1.PolicyTypeIngress}, open.Spec.PolicyTypes,
		"with nowhere named, the runner still pulls images and the policy only admits callers")
	assert.Empty(t, open.Spec.Egress)

	confined := buildRunnerNetworkPolicy(testOwner, "platform", "platform", "default", "test-agents", []string{"0.0.0.0/0"}, []string{"10.128.0.0/14"})
	assert.Contains(t, confined.Spec.PolicyTypes, networkingv1.PolicyTypeEgress)
	require.Len(t, confined.Spec.Egress, 3, "DNS, the paired gateways, and what the install named")

	var sawGateway, sawCIDR bool
	for _, rule := range confined.Spec.Egress {
		for _, to := range rule.To {
			if to.PodSelector != nil && to.PodSelector.MatchLabels[LabelRole] == RoleGateway {
				sawGateway = true
				assert.Equal(t, "test-agents", to.NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"],
					"gateways are reached in the agent namespace, not the release namespace")
			}
			if to.IPBlock != nil && to.IPBlock.CIDR == "0.0.0.0/0" {
				sawCIDR = true
				assert.Equal(t, []string{"10.128.0.0/14"}, to.IPBlock.Except,
					"an open block matches in-cluster addresses too, so the cluster's own ranges are subtracted")
			}
		}
	}
	assert.True(t, sawGateway, "a guest can still reach its own gateway")
	assert.True(t, sawCIDR, "and the runner can still reach the registry, minus the cluster itself")
}

// TEST_SCENARIO: an install names a narrow registry and, as the guidance says, subtracts the cluster's own ranges. Kubernetes rejects a whole NetworkPolicy whose exception falls outside the block it belongs to, so that pairing has to render as a policy the API server will actually accept.
func TestEgressExceptionsAreKeptOnlyWhereTheyFit(t *testing.T) {
	rules := runnerEgress("test-agents",
		[]string{"203.0.113.0/24", "0.0.0.0/0"},
		[]string{"10.128.0.0/14", "172.30.0.0/16"})

	blocks := map[string][]string{}
	for _, rule := range rules {
		for _, to := range rule.To {
			if to.IPBlock != nil {
				blocks[to.IPBlock.CIDR] = to.IPBlock.Except
			}
		}
	}

	assert.Empty(t, blocks["203.0.113.0/24"],
		"a registry block carries no cluster exception, because the API server would reject the policy")
	assert.Equal(t, []string{"10.128.0.0/14", "172.30.0.0/16"}, blocks["0.0.0.0/0"],
		"an open block carries them, which is where they do the work")
}
