// TEST_OVERVIEW: the vm backend runs the agent as a persistent machine on the VM runner instead of a StatefulSet. The controller must hand the node everything the guest needs to be a platform agent (the gateway proxy env, the MITM CA, the persisted paths, an egress allowlist of exactly the paired gateway), publish the machine into the cluster as the agent Service so the api-server dials it like a pod, mirror the machine's readiness onto the Agent status, stop the machine when the agent should not run, and delete it with the agent.
package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
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
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

type fakeNode struct {
	mu       sync.Mutex
	specs    map[string]vmrunner.MachineSpec
	statuses map[string]vmrunner.MachineStatus
	deleted  []string
	puts     []vmrunner.MachineSpec
	version  uint64
	waits    int
}

// UNIT_BOUNDARY_DESCRIPTION: how long the fake holds a waiting status read before answering with no change. It is far below the real runner's wait, so a test's server closes promptly under a watch that is still reading.
const fakeNodeWait = 20 * time.Millisecond

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
				n.version++
				st = vmrunner.MachineStatus{State: vmrunner.StateCreating, Port: 31000, Version: n.version}
				n.statuses[id] = st
			}
			require.NoError(t, json.NewEncoder(w).Encode(st))
		case http.MethodGet:
			if r.URL.Query().Has("wait") {
				n.waits++
				since, err := strconv.ParseUint(r.URL.Query().Get("since"), 10, 64)
				require.NoError(t, err)
				n.mu.Unlock()
				deadline := time.Now().Add(fakeNodeWait)
				for time.Now().Before(deadline) && r.Context().Err() == nil && n.current(id) == since {
					time.Sleep(time.Millisecond)
				}
				n.mu.Lock()
			}
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

// UNIT_BOUNDARY_DESCRIPTION: stores a machine's status under a new version, as the runner moves the version on every change it reports.
func (n *fakeNode) set(id string, st vmrunner.MachineStatus) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.version++
	st.Version = n.version
	n.statuses[id] = st
}

func (n *fakeNode) current(id string) uint64 {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.statuses[id].Version
}

func (n *fakeNode) waitingReads() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.waits
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
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner-" + runnerSuffix(testOwner), Namespace: "test-agents"},
		Data:       map[string][]byte{"token": []byte("node-token")},
	}
}

func runnerTLSSecret() *corev1.Secret {
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner-" + runnerSuffix(testOwner) + "-tls", Namespace: "test-agents"},
		Data:       map[string][]byte{"ca.crt": []byte("RUNNER-CA"), "tls.crt": []byte("CERT"), "tls.key": []byte("KEY")},
	}
}

// TEST_SCENARIO: the runner is kept away from Service and pod addresses, and the cluster's DNS is a Service — so resolving through it is exactly what an egress policy forbids, and a registry pull dies on the lookup. The node's resolver is what a pod confined like this has left.
func TestTheRunnerResolvesThroughTheNodeNotTheCluster(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, corev1.DNSDefault, dep.Spec.Template.Spec.DNSPolicy,
		"ClusterFirst would send every lookup to a Service address the runner's own egress policy drops")
}

// TEST_SCENARIO: an install serving agent images from inside the cluster leaves that range reachable, and then the runner does need Service names — so the choice is the install's, and asking for cluster resolution has to actually produce it.
func TestAnInstallCanAskForClusterResolution(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.DNSPolicy = "ClusterFirst"

	require.NoError(t, r.Reconcile(context.Background(), agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, corev1.DNSClusterFirst, dep.Spec.Template.Spec.DNSPolicy)
}

// TEST_SCENARIO: an owner's runner cannot be placed — no node advertises the KVM devices, or a namespace-wide node selector excludes the ones that do. The Deployment only ever says zero ready replicas, so without the pod's own account the agent reads "still starting" forever and nobody learns why.
func TestAnUnschedulableRunnerSaysWhyOnTheAgent(t *testing.T) {
	agent := vmAgentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	node, srv := newFakeNode(t)
	_ = node
	dep := readyRunnerDeployment()
	dep.Status.ReadyReplicas = 0
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      dep.Name + "-abc",
			Namespace: "test-agents",
			Labels:    map[string]string{"app.kubernetes.io/component": vmRunnerComponent, envoyOwnerLabel: testOwner},
		},
		Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{
			Type: corev1.PodScheduled, Status: corev1.ConditionFalse,
			Message: "0/15 nodes are available: 3 Insufficient devices.kubevirt.io/kvm",
		}}},
	}
	r, _ := setupReconciler(t, agent, leafSecret(), dep, runnerSecret(), runnerTLSSecret(), pod)
	r.config.VM = config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{
		Image: "quay.io/dam-agents/vm-runner:1", Storage: "100Gi", ReserveMiB: 512,
		ServiceAccountName: "platform-vm-runner", ImageCacheBudget: "50Gi",
	}}
	r.runnerEndpoint = func(string) string { return srv.URL }

	require.NoError(t, r.Reconcile(context.Background(), agent))

	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	msg := ""
	for _, c := range conds {
		if m, ok := c.(map[string]interface{}); ok && m["type"] == apiv1.ConditionAgentPodReady {
			msg, _ = m["message"].(string)
		}
	}
	assert.Contains(t, msg, "cannot be scheduled")
	assert.Contains(t, msg, "Insufficient devices.kubevirt.io/kvm",
		"the scheduler's own account reaches the agent, not just the generic starting message")
}

func readyRunnerDeployment() *appsv1.Deployment {
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "platform-vm-runner-" + runnerSuffix(testOwner),
			Namespace: "test-agents",
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

// UNIT_BOUNDARY_DESCRIPTION: the requeues a reconciler asked for, in order. A machine watch asks from its own goroutine, so the log is locked.
type requeueLog struct {
	mu    sync.Mutex
	asked []time.Duration
}

func (l *requeueLog) add(_ string, after time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.asked = append(l.asked, after)
}

func (l *requeueLog) all() []time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]time.Duration(nil), l.asked...)
}

func (l *requeueLog) last() time.Duration {
	all := l.all()
	if len(all) == 0 {
		return -1
	}
	return all[len(all)-1]
}

func setupVMReconciler(t *testing.T, agent *apiv1.Agent) (*AgentReconciler, *fakeNode, *requeueLog) {
	t.Helper()
	node, srv := newFakeNode(t)
	if agent.Labels == nil {
		agent.Labels = map[string]string{}
	}
	agent.Labels[envoyOwnerLabel] = testOwner
	r, _ := setupReconciler(t, agent, leafSecret(), readyRunnerDeployment(), runnerSecret(), runnerTLSSecret())
	r.config.VM = config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{
		Image: "quay.io/dam-agents/vm-runner:1", Storage: "100Gi", ReserveMiB: 512,
		ServiceAccountName: "platform-vm-runner", ImageCacheBudget: "50Gi",
	}}
	r.runnerEndpoint = func(string) string { return srv.URL }
	requeued := &requeueLog{}
	r.WithRequeue(requeued.add)
	t.Cleanup(func() { stopMachineWatches(r) })
	return r, node, requeued
}

func stopMachineWatches(r *AgentReconciler) {
	r.machineWatchMu.Lock()
	defer r.machineWatchMu.Unlock()
	for name, w := range r.machineWatches {
		w.cancel()
		delete(r.machineWatches, name)
	}
}

// TEST_SCENARIO: a private image on the vm backend is fetched by the runner, not by the kubelet, so the pull Secrets a pod would list have to reach the runner. They are the Agent's own imagePullSecretRef first and the install default after it, one document each, so the runner can fall back from a stale Agent credential to the default for the same registry as the kubelet would. They travel on the machine spec and nowhere else: not in the guest's environment.
func TestAVMAgentsPullSecretsReachTheRunnerInPodOrder(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.ImagePullSecretRef = "my-agent-pull"
	r, node, _ := setupVMReconciler(t, agent)
	r.config.AgentBase.ImagePullSecrets = []string{"install-pull"}
	for name, body := range map[string]string{
		"my-agent-pull": `{"auths":{"quay.io":{"auth":"YWdlbnQ="}}}`,
		"install-pull":  `{"auths":{"quay.io":{"auth":"ZGVmYXVsdA=="}}}`,
	} {
		_, err := r.client.CoreV1().Secrets("test-agents").Create(context.Background(), &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "test-agents"},
			Type:       corev1.SecretTypeDockerConfigJson,
			Data:       map[string][]byte{corev1.DockerConfigJsonKey: []byte(body)},
		}, metav1.CreateOptions{})
		require.NoError(t, err)
	}

	require.NoError(t, r.Reconcile(context.Background(), agent))

	spec := node.spec("my-agent")
	require.Len(t, spec.PullAuths, 2)
	assert.Contains(t, spec.PullAuths[0], "YWdlbnQ=", "the Agent's own Secret is tried first")
	assert.Contains(t, spec.PullAuths[1], "ZGVmYXVsdA==", "and the default for the same registry is kept to fall back to")
	for k, v := range spec.Env {
		assert.NotContains(t, v, "YWdlbnQ=", "the credential is not in the guest's environment (%s)", k)
	}
}

// TEST_SCENARIO: an Agent with no pull Secret, on an install with no default, fetches anonymously. That was the only behaviour before, and it must stay the same, with no empty credential document on the wire.
func TestAVMAgentWithNoPullSecretFetchesAnonymously(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Empty(t, node.spec("my-agent").PullAuths)
}

// TEST_SCENARIO: a vm agent wakes: the node gets a running machine shaped by the agent's size and mounts, wired to its gateway alone and carrying the restart revision; the cluster gets an agent Service that selects the owner's runner and maps the agent port onto the one this machine publishes there, and no agent StatefulSet; the Agent reads not-ready until the guest answers, and since no pod event will come the reconciler watches the machine itself.
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
	assert.Equal(t, "localhost,127.0.0.1,::1,"+vmGuestLocalCIDRs, spec.Env["NO_PROXY"], "a guest reaches its own network directly; only the gateway is worth proxying")
	assert.Equal(t, spec.Env["NO_PROXY"], spec.Env["no_proxy"], "clients reading either casing see the same list")
	assert.Equal(t, "7", spec.Revision, "the restart verb's roll revision reaches the machine")
	assert.Equal(t, "my-agent", spec.Env["PLATFORM_AGENT_ID"])

	_, err := r.client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	assert.True(t, err != nil, "no agent StatefulSet for a vm agent")
	_, err = r.client.AppsV1().StatefulSets("test-agents").Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "the paired gateway is unchanged")

	svc, err := r.client.CoreV1().Services("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, vmRunnerSelector(testOwner), svc.Spec.Selector, "the agent Service selects the owner's runner")
	assert.NotEqual(t, corev1.ClusterIPNone, svc.Spec.ClusterIP, "a headless Service would hand back the pod address without remapping the port")
	assert.Equal(t, intstr.FromInt(31000), svc.Spec.Ports[0].TargetPort, "the agent port maps onto the one this machine publishes on the runner")

	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, metav1.ConditionFalse, cond.Status)
	assert.True(t, r.watchingMachine("my-agent"), "a machine whose creation is still in flight is watched — its guest can answer before that call returns")
	assert.Equal(t, []time.Duration{vmHealthPoll}, requeued.all(), "and the Agent is not reconciled again until something changes")

	markGatewayReady(t, r)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
	require.Eventually(t, func() bool { return !r.watchingMachine("my-agent") }, 5*time.Second, time.Millisecond,
		"the guest answering ends the watch")
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, metav1.ConditionTrue, readyCondition(t, r, "my-agent").Status)
	assert.False(t, r.watchingMachine("my-agent"), "a ready machine is not watched")
	assert.Equal(t, vmHealthPoll, requeued.last(), "a ready machine is still polled, just slowly — nothing else would notice its guest dying")
}

// TEST_SCENARIO: a machine on its way up is watched with a long poll on its runner, not by running the whole reconcile twice a second. However often the Agent reconciles, it has one watch; while the status holds still nothing is requeued; and the moment the status changes — the guest answering — the Agent is requeued at once, and the watch ends so the reconcile that follows can publish the change.
func TestAMachineComingUpIsWatchedAndAChangeRequeuesTheAgent(t *testing.T) {
	agent := vmAgentCR()
	r, node, requeued := setupVMReconciler(t, agent)
	ctx := context.Background()

	require.NoError(t, r.Reconcile(ctx, agent))
	require.True(t, r.watchingMachine("my-agent"))
	first := r.machineWatches["my-agent"]
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Same(t, first, r.machineWatches["my-agent"], "a second reconcile does not start a second watch")

	require.Eventually(t, func() bool { return node.waitingReads() >= 3 }, 5*time.Second, time.Millisecond,
		"the watch asks again each time a read ends with no change")
	assert.NotContains(t, requeued.all(), time.Duration(0), "an unchanged status requeues nothing")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
	require.Eventually(t, func() bool { return slices.Contains(requeued.all(), time.Duration(0)) }, 5*time.Second, time.Millisecond,
		"a change requeues the Agent at once")
	assert.Eventually(t, func() bool { return !r.watchingMachine("my-agent") }, 5*time.Second, time.Millisecond)
}

// TEST_SCENARIO: a watch belongs to a machine on its way up and ends with it. Hibernating the Agent or deleting it ends the watch without a requeue, since whatever did that reconciles the Agent itself; a machine that failed is not watched, and waits for the health poll.
func TestAMachineWatchEndsWhenTheAgentStopsOrGoes(t *testing.T) {
	agent := vmAgentCR()
	r, node, requeued := setupVMReconciler(t, agent)
	ctx := context.Background()

	require.NoError(t, r.Reconcile(ctx, agent))
	require.True(t, r.watchingMachine("my-agent"))
	require.NoError(t, r.HaltMachine(ctx, testOwner, "my-agent"))
	assert.False(t, r.watchingMachine("my-agent"), "hibernating ends the watch")
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	time.Sleep(10 * fakeNodeWait)
	assert.NotContains(t, requeued.all(), time.Duration(0), "an ended watch requeues nothing")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStarting, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	require.True(t, r.watchingMachine("my-agent"))
	r.deleteMachine(ctx, "my-agent", testOwner)
	assert.False(t, r.watchingMachine("my-agent"), "deleting ends the watch")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000, Reason: vmrunner.ReasonBootFailed, Message: "kernel panic"})
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.False(t, r.watchingMachine("my-agent"), "a failed machine is not on its way up")
	assert.Equal(t, vmHealthPoll, requeued.last())
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
	r.Delete(context.Background(), "my-agent", agent.Labels)
	assert.Equal(t, []string{"my-agent"}, node.deleted)
}

// UNIT_BOUNDARY_DESCRIPTION: stands in for cert-manager, which issues the runner's TLS Secret some time after its Certificate is applied.
func issueRunnerTLS(t *testing.T, r *AgentReconciler, owner string) {
	t.Helper()
	tls := runnerTLSSecret()
	tls.Name = r.runnerTLSName(owner)
	_, err := r.client.CoreV1().Secrets("test-agents").Create(context.Background(), tls, metav1.CreateOptions{})
	if !k8serrors.IsAlreadyExists(err) {
		require.NoError(t, err)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: a second owner's runner, with its own fake node behind it, so a test can tell which runner a call reached.
func addRunner(t *testing.T, r *AgentReconciler, owner string) *fakeNode {
	t.Helper()
	ctx := context.Background()
	node, srv := newFakeNode(t)
	dep := readyRunnerDeployment()
	dep.Name, dep.Labels[envoyOwnerLabel] = r.runnerName(owner), owner
	_, err := r.client.AppsV1().Deployments("test-agents").Create(ctx, dep, metav1.CreateOptions{})
	require.NoError(t, err)
	sec := runnerSecret()
	sec.Name = r.runnerName(owner)
	_, err = r.client.CoreV1().Secrets("test-agents").Create(ctx, sec, metav1.CreateOptions{})
	require.NoError(t, err)
	issueRunnerTLS(t, r, owner)
	first := r.runnerEndpoint
	r.runnerEndpoint = func(o string) string {
		if o == owner {
			return srv.URL
		}
		return first(o)
	}
	return node
}

// TEST_SCENARIO: the deleted Agent's owner label names the runner its machine is on, so only that runner is asked. Another owner's runner is not called at all, and an owner with no runner gets no Secret minted for a runner that does not exist.
func TestADeleteReachesOnlyTheOwnersRunner(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	other := addRunner(t, r, "owner-b")

	r.Delete(ctx, "my-agent", agent.Labels)
	assert.Equal(t, []string{"my-agent"}, node.deleted)
	assert.Empty(t, other.deleted, "another owner's runner is not asked about this Agent's machine")

	r.Delete(ctx, "no-runner-agent", map[string]string{envoyOwnerLabel: "owner-without-runner"})
	_, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, r.runnerName("owner-without-runner"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "a delete does not mint credentials for a runner that does not exist")
}

// TEST_SCENARIO: an Agent whose labels were never seen, the informer having lost its last state, still has a machine somewhere, so a delete without an owner is offered to every runner.
func TestADeleteWithNoOwnerReachesEveryRunner(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	other := addRunner(t, r, "owner-b")

	r.Delete(context.Background(), "my-agent", nil)
	assert.Equal(t, []string{"my-agent"}, node.deleted)
	assert.Equal(t, []string{"my-agent"}, other.deleted)
}

// TEST_SCENARIO: the sweep needs every runner's token and CA, and runs every ten minutes over every owner. Both of a runner's Secrets carry the component label — the token by the controller, the TLS Secret by cert-manager from the Certificate's template — so one List serves them all and no Secret is read by name.
func TestTheSweepReadsRunnerSecretsInOneList(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	for _, owner := range []string{testOwner, "owner-b"} {
		if owner != testOwner {
			addRunner(t, r, owner)
		}
		for _, name := range []string{r.runnerName(owner), r.runnerTLSName(owner)} {
			sec, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, name, metav1.GetOptions{})
			require.NoError(t, err)
			sec.Labels = vmRunnerLabels(owner, r.config.ReleaseName)
			_, err = r.client.CoreV1().Secrets("test-agents").Update(ctx, sec, metav1.UpdateOptions{})
			require.NoError(t, err)
		}
	}
	fakeClient := r.client.(*fake.Clientset)
	fakeClient.ClearActions()

	runners, err := r.knownRunners(ctx)
	require.NoError(t, err)
	assert.Len(t, runners, 2)
	for _, action := range fakeClient.Actions() {
		assert.False(t, action.GetResource().Resource == "secrets" && action.GetVerb() == "get",
			"a runner Secret was read by name although the List already returned it")
	}
}

// TEST_SCENARIO: the guest's MITM CA comes from the same leaf Secret the pod mounts; until cert-manager issues it there is nothing to boot with, so the reconcile requeues instead of creating a machine that cannot trust its gateway.
func TestVMBackendWaitsForTheLeafSecret(t *testing.T) {
	agent := vmAgentCR()
	node, srv := newFakeNode(t)
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	r, _ := setupReconciler(t, agent, readyRunnerDeployment(), runnerSecret(), runnerTLSSecret())
	r.config.VM = config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{Image: "vm-runner:1", Storage: "100Gi", ImageCacheBudget: "50Gi"}}
	r.runnerEndpoint = func(string) string { return srv.URL }
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

	_, _, err := r.ensureRunner(ctx, "owner-a", runnerDemand{})
	require.ErrorIs(t, err, errRunnerTLSPending, "a runner is not dialled before cert-manager issues its certificate")
	_, _, err = r.ensureRunner(ctx, "owner-b", runnerDemand{})
	require.ErrorIs(t, err, errRunnerTLSPending)

	a, b := r.runnerName("owner-a"), r.runnerName("owner-b")
	assert.NotEqual(t, a, b, "one runner per owner")
	for _, name := range []string{a, b} {
		dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err)
		assert.Equal(t, int32(1), *dep.Spec.Replicas)
		pvc, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err)
		assert.Equal(t, "100Gi", pvc.Spec.Resources.Requests.Storage().String())
		_, err = r.client.CoreV1().Services("test-agents").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err)
		np, err := r.client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, name+"-ingress", metav1.GetOptions{})
		require.NoError(t, err)
		assert.Len(t, np.Spec.Ingress[0].From, 2, "only the api-server and the controller may dial a runner")
	}

	secretA, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, a, metav1.GetOptions{})
	require.NoError(t, err)
	secretB, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, b, metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEqual(t, secretA.Data["token"], secretB.Data["token"], "a runner's token is its own")
	for _, owner := range []string{"owner-a", "owner-b"} {
		cert, err := r.dynamic.Resource(certificateGVR).Namespace("test-agents").Get(ctx, r.runnerTLSName(owner), metav1.GetOptions{})
		require.NoError(t, err, "each runner asks cert-manager for a certificate of its own")
		hosts, _, _ := unstructured.NestedStringSlice(cert.Object, "spec", "dnsNames")
		assert.Equal(t, []string{r.runnerHost(owner)}, hosts)
	}

	r.deleteRunner(ctx, "owner-a")
	_, err = r.client.AppsV1().Deployments("test-agents").Get(ctx, a, metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "an owner with no vm agents keeps no runner")
	_, err = r.dynamic.Resource(certificateGVR).Namespace("test-agents").Get(ctx, r.runnerTLSName("owner-a"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "nor a certificate for one")
	_, err = r.client.AppsV1().Deployments("test-agents").Get(ctx, b, metav1.GetOptions{})
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

// TEST_SCENARIO: the disk carries a size that does not parse; the reconcile fails instead of booting the guest on the 1 GiB floor, which would look healthy and run out of disk later.
func TestVMBackendRefusesADiskSizeItCannotParse(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.StorageSize = "5GG"
	r, node, _ := setupVMReconciler(t, agent)

	err := r.Reconcile(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "5GG")
	assert.Empty(t, node.specs, "no machine is created from a spec the controller could not size")
}

// TEST_SCENARIO: a machine has one disk, so the Agent's own storage size is the whole of it. The container backend's mounts cannot say that — each is a volume with a size of its own — so summing them bought a number no single path was held to, and rounding each up to a GiB first paid for that rounding once per mount. Here two persisted mounts of 4Gi each are one 10Gi disk.
func TestVMBackendSizesOneDiskRatherThanSummingMounts(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.Mounts = []apiv1.Mount{
		{Path: "/home/agent", Persist: true, Size: "4Gi"},
		{Path: "/home/agent/work", Persist: true, Size: "4Gi"},
	}
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Equal(t, 10, node.spec("my-agent").StorageGiB, "the Agent's storage size, not 4+4")
}

// TEST_SCENARIO: the default template's mounts — HOME persisted, /tmp not — are what every shipped template and starter kit declares, and they are exactly what a machine already does: HOME on the disk, everything else discarded with the root at the next stop. So the common case reconciles with nothing to decide.
func TestVMBackendAcceptsTheDefaultMounts(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.Mounts = []apiv1.Mount{
		{Path: "/home/agent", Persist: true},
		{Path: "/tmp", Persist: false},
	}
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Equal(t, 10, node.spec("my-agent").StorageGiB)
}

// TEST_SCENARIO: a machine keeps HOME and nothing else, so a mount asking to persist a path outside it cannot be honoured. Dropping it silently is the failure this backend exists to stop being possible — the agent would run, look healthy, and lose that path the first time it stopped — so the reconcile fails and says where the path would have to move.
func TestVMBackendRefusesAPersistedMountOutsideHome(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.Mounts = []apiv1.Mount{
		{Path: "/home/agent", Persist: true},
		{Path: "/data", Persist: true},
	}
	r, node, _ := setupVMReconciler(t, agent)

	err := r.Reconcile(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "/data")
	assert.Empty(t, node.specs, "no machine is created that would discard a path its Agent asked to keep")
}

// TEST_SCENARIO: a mount's own size wins over the Agent's storageSize on the container backend, so a spec that asks for 50Gi there must not quietly get the chart's default here. The machine has one disk, so the largest thing any persisted mount asks for is what it is sized to — the one field of Mount this backend could still drop without saying so.
func TestTheMachineDiskIsNoSmallerThanAnyMountAsksFor(t *testing.T) {
	disk := func(configure func(*apiv1.AgentSpec)) int {
		agent := vmAgentCR()
		configure(&agent.Spec)
		r, node, _ := setupVMReconciler(t, agent)
		require.NoError(t, r.Reconcile(context.Background(), agent))
		return node.spec("my-agent").StorageGiB
	}

	assert.Equal(t, 50, disk(func(spec *apiv1.AgentSpec) {
		spec.Mounts = []apiv1.Mount{{Path: "/home/agent", Persist: true, Size: "50Gi"}}
	}), "the mount's own size raises the disk rather than being dropped")

	assert.Equal(t, 50, disk(func(spec *apiv1.AgentSpec) {
		spec.StorageSize = "20Gi"
		spec.Mounts = []apiv1.Mount{{Path: "/home/agent", Persist: true, Size: "50Gi"}}
	}), "a mount that asks for more than storageSize wins, as it does on the container backend")

	assert.Equal(t, 20, disk(func(spec *apiv1.AgentSpec) {
		spec.StorageSize = "20Gi"
		spec.Mounts = []apiv1.Mount{{Path: "/home/agent", Persist: true, Size: "5Gi"}}
	}), "a mount asking for less never shrinks the disk below what the Agent itself declared")

	assert.Equal(t, 50, disk(func(spec *apiv1.AgentSpec) {
		spec.Mounts = []apiv1.Mount{
			{Path: "/home/agent", Persist: true, Size: "50Gi"},
			{Path: "/home/agent/work", Persist: true, Size: "30Gi"},
		}
	}), "nested mounts share the one disk, so it is the largest of them and not their sum")

	assert.Equal(t, 10, disk(func(spec *apiv1.AgentSpec) {
		spec.Mounts = []apiv1.Mount{
			{Path: "/home/agent", Persist: true},
			{Path: "/tmp", Persist: false, Size: "80Gi"},
		}
	}), "a size on a path the machine never keeps buys nothing, since nothing is written there across a stop")
}

// TEST_SCENARIO: images/ is the directory that may not be on the runner's claim at all — a node cache the runners there share, or a read-only host directory of staged archives — so it gets a mount of its own rather than being a directory inside a parent mount. The other two always live on the claim and are mounted by subPath, so the claim's root is never exposed.
func TestRunnerMountsTheImageCacheAsItsOwnSource(t *testing.T) {
	mounts := func(configure func(*config.VMRunnerSpec)) (map[string]corev1.VolumeMount, map[string]corev1.Volume) {
		r, _, _ := setupVMReconciler(t, vmAgentCR())
		configure(&r.config.VM.Runner)
		require.NoError(t, r.applyRunnerDeployment(context.Background(), testOwner))
		dep, err := r.client.AppsV1().Deployments("test-agents").Get(
			context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
		require.NoError(t, err)
		byPath := map[string]corev1.VolumeMount{}
		for _, m := range dep.Spec.Template.Spec.Containers[0].VolumeMounts {
			byPath[m.MountPath] = m
		}
		byName := map[string]corev1.Volume{}
		for _, v := range dep.Spec.Template.Spec.Volumes {
			byName[v.Name] = v
		}
		return byPath, byName
	}

	plain, _ := mounts(func(*config.VMRunnerSpec) {})
	assert.Equal(t, "disks", plain[vmRunnerDisksPath].SubPath)
	assert.Equal(t, "machines", plain[vmRunnerMachinesPath].SubPath)
	assert.Equal(t, "images", plain[vmRunnerImagesPath].SubPath,
		"with no node cache the images are still their own mount, not a directory inside another")

	node, volumes := mounts(func(spec *config.VMRunnerSpec) { spec.ImageCacheHostPath = "/var/lib/platform-images" })
	assert.Empty(t, node[vmRunnerImagesPath].SubPath)
	assert.Equal(t, "image-cache", node[vmRunnerImagesPath].Name, "the node directory replaces that mount rather than nesting in it")
	require.NotNil(t, volumes["image-cache"].HostPath, "the node cache is a host directory, not a claim of its own")
	assert.Equal(t, "/var/lib/platform-images", volumes["image-cache"].HostPath.Path)
	assert.True(t, node[vmRunnerImagesPath].ReadOnly, "the node's image cache service is the only writer of the node directory")
}

// TEST_SCENARIO: on a node cache the runner reaches the node's image cache service through a socket the chart's DaemonSet binds inside the same directory. The controller and the chart each name that path, so the controller's constant must be the one the chart passes, or every runner on a node cache refuses every image as unavailable. With no node cache the runner is told no socket, and is its cache's only writer.
func TestTheRunnerDialsTheSocketTheImageCacheServiceBinds(t *testing.T) {
	template, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "helm", "templates", "controller", "vm-image-cache.yaml"))
	require.NoError(t, err)
	assert.Contains(t, string(template), "- --socket="+vmImageCacheSocket+"\n")
	assert.Contains(t, string(template), "mountPath: "+vmRunnerImagesPath+"\n")

	args := func(configure func(*config.VMRunnerSpec)) []string {
		r, _, _ := setupVMReconciler(t, vmAgentCR())
		configure(&r.config.VM.Runner)
		require.NoError(t, r.applyRunnerDeployment(context.Background(), testOwner))
		dep, err := r.client.AppsV1().Deployments("test-agents").Get(
			context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
		require.NoError(t, err)
		return dep.Spec.Template.Spec.Containers[0].Args
	}
	assert.Contains(t, args(func(spec *config.VMRunnerSpec) { spec.ImageCacheHostPath = "/var/lib/platform-images" }),
		"--image-cache-socket="+vmImageCacheSocket)
	assert.Contains(t, args(func(*config.VMRunnerSpec) {}), "--image-cache-socket=")
}

// TEST_SCENARIO: every cache carries a budget, because the runner's own claim is shared with the machine disks just as a node directory is shared with the rest of the host — neither can be given a share of its filesystem. A budget the controller cannot read fails the reconcile rather than being replaced by a guess, which would be a cache growing until something it shares with runs out.
func TestEveryCacheIsBounded(t *testing.T) {
	args := func(t *testing.T, configure func(*config.VMRunnerSpec)) (string, error) {
		r, _, _ := setupVMReconciler(t, vmAgentCR())
		configure(&r.config.VM.Runner)
		if err := r.applyRunnerDeployment(context.Background(), testOwner); err != nil {
			return "", err
		}
		dep, err := r.client.AppsV1().Deployments("test-agents").Get(
			context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
		require.NoError(t, err)
		return strings.Join(dep.Spec.Template.Spec.Containers[0].Args, " "), nil
	}

	own, err := args(t, func(spec *config.VMRunnerSpec) { spec.ImageCacheBudget = "20Gi" })
	require.NoError(t, err)
	assert.Contains(t, own, fmt.Sprintf("--image-budget-bytes=%d", 20*(1<<30)))

	shared, err := args(t, func(spec *config.VMRunnerSpec) {
		spec.ImageCacheHostPath = "/var/lib/platform-images"
		spec.ImageCacheBudget = "20Gi"
	})
	require.NoError(t, err)
	assert.Contains(t, shared, fmt.Sprintf("--image-budget-bytes=%d", 20*(1<<30)),
		"the same number bounds the node directory, which is shared with the whole host")

	for _, bad := range []string{"", "plenty", "0"} {
		_, err := args(t, func(spec *config.VMRunnerSpec) { spec.ImageCacheBudget = bad })
		require.Error(t, err, "budget %q", bad)
		assert.Contains(t, err.Error(), "image cache budget")
	}
}

// TEST_SCENARIO: the runner now sits in the agent namespace while the api-server and controller stay in the release namespace, so its ingress peers have to name that namespace — a bare pod selector matches only the policy's own namespace, which would admit nobody and strand every vm agent.
func TestRunnerPolicyAdmitsItsCallersAcrossNamespaces(t *testing.T) {
	np := buildRunnerNetworkPolicy(testOwner, "platform", "platform", "test-agents", "release-ns", testConfig.EnvoyPort, nil, nil)

	require.Len(t, np.Spec.Ingress, 2, "the machine API and published ports, and the scrape port")
	for _, rule := range np.Spec.Ingress {
		require.NotEmpty(t, rule.From)
		for _, from := range rule.From {
			require.NotNil(t, from.NamespaceSelector, "a bare pod selector would only match the runner's own namespace")
			assert.Equal(t, "release-ns", from.NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"])
		}
	}
}

// TEST_SCENARIO: the scrape port carries no token, so the NetworkPolicy is its only gate — it must admit the platform's collector to that port alone, and nothing else may reach it, while the collector reaches nothing but it.
func TestRunnerPolicyAdmitsOnlyTheCollectorToTheScrapePort(t *testing.T) {
	np := buildRunnerNetworkPolicy(testOwner, "platform", "platform", "test-agents", "release-ns", testConfig.EnvoyPort, nil, nil)

	var scrapers []string
	for _, rule := range np.Spec.Ingress {
		reachesScrape := false
		for _, port := range rule.Ports {
			if port.Port.IntValue() == vmRunnerMetricsPort {
				reachesScrape = true
			}
		}
		for _, from := range rule.From {
			component := from.PodSelector.MatchLabels["app.kubernetes.io/component"]
			if component == vmRunnerMetricsScraper {
				require.Len(t, rule.Ports, 1, "the collector reaches the scrape port and nothing else")
			}
			if reachesScrape {
				scrapers = append(scrapers, component)
			}
		}
	}
	assert.Equal(t, []string{vmRunnerMetricsScraper}, scrapers)
}

// TEST_SCENARIO: the release is not called `platform`, so the chart's fullname and the Helm release name diverge; the runner's ingress policy must still select the api-server and controller pods, which carry the release name — selecting on the fullname would admit nobody and strand every vm agent.
func TestRunnerPolicyAdmitsPeersWhenTheReleaseNameDiffersFromTheFullname(t *testing.T) {
	np := buildRunnerNetworkPolicy(testOwner, "dam-platform", "dam", "test-agents", "default", testConfig.EnvoyPort, nil, nil)

	var instances []string
	for _, rule := range np.Spec.Ingress {
		for _, from := range rule.From {
			instances = append(instances, from.PodSelector.MatchLabels["app.kubernetes.io/instance"])
		}
	}
	require.Len(t, instances, 3, "the api-server, the controller and the collector, and nothing else")
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

	refusal, err := r.resizeAllows(context.Background(), agent, testOwner)
	require.NoError(t, err, "an unreachable runner must not fail the reconcile")
	assert.Empty(t, refusal)
}

// TEST_SCENARIO: switching virtualization off and on deletes the runner ServiceAccount and renders a new one, which carries a new UID. A controller that resolved the owner once would keep stamping the dead UID, and every object it wrote would be collected the instant it appeared — a runner that never shows up and never explains why.
func TestRunnerOwnershipFollowsARecreatedServiceAccount(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	sas := r.client.CoreV1().ServiceAccounts("test-agents")
	_, err := sas.Create(ctx, &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner", Namespace: "test-agents", UID: "uid-before"},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	require.Equal(t, types.UID("uid-before"), r.runnerOwnerRef(ctx)[0].UID)

	require.NoError(t, sas.Delete(ctx, "platform-vm-runner", metav1.DeleteOptions{}))
	_, err = sas.Create(ctx, &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner", Namespace: "test-agents", UID: "uid-after"},
	}, metav1.CreateOptions{})
	require.NoError(t, err)

	refs := r.runnerOwnerRef(ctx)
	require.Len(t, refs, 1)
	assert.Equal(t, types.UID("uid-after"), refs[0].UID,
		"a stale UID here is collected by the garbage collector the moment a runner object is written")
}

// TEST_SCENARIO: Helm never sees a runner — the controller creates it — so nothing would remove one on uninstall, on rollback, or when virtualization is switched off. Every object it creates is owned by the ServiceAccount the chart does render, which sits in the same namespace because an owner reference may not cross one; a single object missing the reference strands a running VM and its disk.
func TestRunnerObjectsAreOwnedByTheRunnerServiceAccount(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	_, err := r.client.CoreV1().ServiceAccounts("test-agents").Create(ctx, &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner", Namespace: "test-agents", UID: "runner-sa-uid"},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	name := r.runnerName(testOwner)
	require.NoError(t, r.client.CoreV1().Secrets("test-agents").Delete(ctx, name, metav1.DeleteOptions{}))

	require.ErrorContains(t, r.Reconcile(ctx, agent), "VM runner", "the fresh token is rejected by the fake runner, which happens after every object below exists")

	owners := map[string][]metav1.OwnerReference{}
	sec, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	owners["secret"] = sec.OwnerReferences
	tls, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, r.runnerTLSName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	owners["tls secret"] = tls.OwnerReferences
	cert, err := r.dynamic.Resource(certificateGVR).Namespace("test-agents").Get(ctx, r.runnerTLSName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	owners["certificate"] = cert.GetOwnerReferences()
	pvc, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	owners["pvc"] = pvc.OwnerReferences
	svc, err := r.client.CoreV1().Services("test-agents").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	owners["service"] = svc.OwnerReferences
	np, err := r.client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, name+"-ingress", metav1.GetOptions{})
	require.NoError(t, err)
	owners["networkpolicy"] = np.OwnerReferences
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	owners["deployment"] = dep.OwnerReferences

	for kind, refs := range owners {
		require.Len(t, refs, 1, "%s carries no owner, so it would outlive the release", kind)
		assert.Equal(t, types.UID("runner-sa-uid"), refs[0].UID, "%s is owned by the controller", kind)
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

	_, err = r.client.CoreV1().PersistentVolumeClaims("test-agents").
		Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err, "the runner's disk survives a sweep that raced a machine")
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

// TEST_SCENARIO: the controller trusts a runner by the CA that issued its certificate, so the certificate has to name the Service the controller dials, come from the install's CA issuer, and label its Secret so the sweep finds it. A TLS Secret with no CA in it must be refused, because an empty trust pool silently falls back to the system roots.
func TestTheRunnerCertificateNamesTheServiceTheControllerDials(t *testing.T) {
	r, _ := setupReconciler(t, vmAgentCR())
	r.config.EnvoyMitmCAIssuer = "platform-mitm-ca-issuer"

	cert := r.buildRunnerCertificate(testOwner, nil)
	assert.Equal(t, []string{r.runnerHost(testOwner)}, cert.Spec.DNSNames, "the cert names the Service the controller dials")
	assert.Equal(t, r.runnerTLSName(testOwner), cert.Spec.SecretName)
	assert.Equal(t, "platform-mitm-ca-issuer", cert.Spec.IssuerRef.Name)
	assert.Equal(t, vmRunnerComponent, cert.Spec.SecretTemplate.Labels["app.kubernetes.io/component"])

	ctx := context.Background()
	tls := runnerTLSSecret()
	delete(tls.Data, "ca.crt")
	for _, sec := range []*corev1.Secret{runnerSecret(), tls} {
		_, err := r.client.CoreV1().Secrets("test-agents").Create(ctx, sec, metav1.CreateOptions{})
		require.NoError(t, err)
	}
	_, err := r.runnerFor(ctx, testOwner)
	require.ErrorContains(t, err, "no ca.crt")

	_, err = vmrunner.NewClient("https://x:4600", "token", "not-a-cert")
	require.Error(t, err, "and refuses to dial with something that is not a certificate")
}

// TEST_SCENARIO: a new owner's runner cannot serve until cert-manager issues its certificate, and its pod cannot mount the Secret before then. The reconcile requeues, as it does for a gateway's leaf, rather than marking the Agent failed, and no machine is asked for.
func TestVMBackendWaitsForTheRunnerCertificate(t *testing.T) {
	agent := vmAgentCR()
	node, srv := newFakeNode(t)
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	r, _ := setupReconciler(t, agent, leafSecret(), readyRunnerDeployment(), runnerSecret())
	r.config.VM = config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{Image: "vm-runner:1", Storage: "100Gi", ImageCacheBudget: "50Gi"}}
	r.runnerEndpoint = func(string) string { return srv.URL }

	err := r.Reconcile(context.Background(), agent)
	require.ErrorIs(t, err, errRunnerTLSPending)
	assert.Empty(t, node.specs)
	_, err = r.dynamic.Resource(certificateGVR).Namespace("test-agents").Get(context.Background(), r.runnerTLSName(testOwner), metav1.GetOptions{})
	require.NoError(t, err, "the certificate is asked for on the same pass")
}

// TEST_SCENARIO: an install says where its runner may go; the policy then confines the pod as well as admitting callers, which is the only kernel gate behind a guest's egress allowlist — smolvm enforces that allowlist inside the process an escaped guest would already own.
func TestRunnerPolicyConfinesTheRunnerWhenEgressIsConfigured(t *testing.T) {
	open := buildRunnerNetworkPolicy(testOwner, "platform", "platform", "test-agents", "default", testConfig.EnvoyPort, nil, nil)
	assert.Equal(t, []networkingv1.PolicyType{networkingv1.PolicyTypeIngress}, open.Spec.PolicyTypes,
		"with nowhere named, the runner still pulls images and the policy only admits callers")
	assert.Empty(t, open.Spec.Egress)

	confined := buildRunnerNetworkPolicy(testOwner, "platform", "platform", "test-agents", "default", testConfig.EnvoyPort, []string{"0.0.0.0/0"}, []string{"10.128.0.0/14"})
	assert.Contains(t, confined.Spec.PolicyTypes, networkingv1.PolicyTypeEgress)
	require.Len(t, confined.Spec.Egress, 3, "DNS, the owner's gateways, and what the install named")

	var sawGateway, sawCIDR bool
	for _, rule := range confined.Spec.Egress {
		for _, to := range rule.To {
			if to.PodSelector != nil && to.PodSelector.MatchLabels[LabelRole] == RoleGateway {
				sawGateway = true
				assert.Equal(t, testOwner, to.PodSelector.MatchLabels[envoyOwnerLabel],
					"only this owner's gateways — another owner's hold credentials this runner's guests must never borrow")
				require.Len(t, rule.Ports, 1, "the gateway's proxy port alone: nothing else on a gateway is meant for a guest")
				assert.Equal(t, int32(testConfig.EnvoyPort), rule.Ports[0].Port.IntVal)
				assert.Equal(t, corev1.ProtocolTCP, *rule.Ports[0].Protocol)
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
	rules := runnerEgress("test-agents", testOwner, testConfig.EnvoyPort,
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

// TEST_SCENARIO: an agent the runner refused is parked and retried every 30s, so the gateway must not be brought up and taken down on that cadence — a scheduled and killed pod each cycle, for an agent that cannot run.
func TestAParkedAgentDoesNotBringItsGatewayUpFirst(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses["my-agent"] = vmrunner.MachineStatus{
		State:   vmrunner.StateCreating,
		Reason:  vmrunner.ReasonOutOfCapacity,
		Message: "does not fit",
	}

	require.NoError(t, r.Reconcile(ctx, agent))

	for _, action := range r.client.(*fake.Clientset).Actions() {
		written, ok := action.(k8stesting.CreateAction)
		if !ok {
			continue
		}
		ss, _ := written.GetObject().(*appsv1.StatefulSet)
		if ss == nil || ss.Name != GatewayName("my-agent") || ss.Spec.Replicas == nil {
			continue
		}
		assert.Equal(t, int32(0), *ss.Spec.Replicas, "the gateway is never written as running for an agent the runner refused")
	}
	r.budgetMu.Lock()
	_, queued := r.parkedRetry["my-agent"]
	r.budgetMu.Unlock()
	assert.True(t, queued, "and the agent is queued to try again when room frees")
}

// TEST_SCENARIO: the runner unpacks each image once for every machine of it to share, and restoring a rootfs faithfully means writing the ownership and modes its files carry. Under a policy that drops every capability tar cannot: it fails on chown, then — given only CHOWN — on setting a mode it no longer owns, and then on writing into a directory it has just given away, which bits forbid even to root. All three are therefore held, or an image that is not already cached cannot be unpacked and no machine can be created from it.
func TestTheRunnerHoldsWhatUnpackingAnImageNeeds(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(context.Background(), agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(
		context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	caps := dep.Spec.Template.Spec.Containers[0].SecurityContext.Capabilities
	require.NotNil(t, caps)
	assert.Contains(t, caps.Add, corev1.Capability("DAC_OVERRIDE"),
		"and then writes into a directory it has just given away")
	assert.Contains(t, caps.Add, corev1.Capability("NET_ADMIN"), "the per-machine NAT still needs this")
	assert.Contains(t, caps.Add, corev1.Capability("CHOWN"), "tar chowns each file to the uid the image gave it")
	assert.Contains(t, caps.Add, corev1.Capability("FOWNER"), "and then sets a mode on a file it no longer owns")
	require.NotNil(t, dep.Spec.Template.Spec.EnableServiceLinks)
	assert.False(t, *dep.Spec.Template.Spec.EnableServiceLinks,
		"service links would inject one env var set per sibling agent Service; the runner reads none of them")
}

// TEST_SCENARIO: a runner with no ready replica reports nothing about its machines, so the reconcile gets an empty machine status. The runner keeps its restart counter in memory and reports it again once it is back. Publishing the empty status as zero restarts would make that return read as a rise, and the UI would announce a restart that never happened.
func TestAnUnreachableRunnerKeepsThePublishedRestarts(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	ctx := context.Background()

	require.NoError(t, r.publishVMReadiness(ctx, agent,
		vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Restarts: 2}, true))
	restarts, _ := agentRestartStatus(t, r, agent.Name)
	require.Equal(t, int64(2), restarts, "precondition: the count was published")

	require.NoError(t, r.publishVMReadiness(ctx, agent,
		vmrunner.MachineStatus{Message: "vm runner is not ready"}, false))

	restarts, reason := agentRestartStatus(t, r, agent.Name)
	assert.Equal(t, int64(2), restarts)
	assert.Equal(t, "GuestStoppedAnswering", reason)
}

// TEST_SCENARIO: smolvm would give each machine's VMM an unprivileged uid of its own, and this runner refuses it, because a VMM that took one reaches what the runner shares with it through an idmapped mount of a single entry — on-disk uid 0 — so every file the image gives another uid arrives as nobody and the workload exits at once; machines whose rootfs came from a per-machine archive failed to finish starting under the drop as well. The refusal is stated in the environment and backed by withholding the capabilities a uid change needs, since a runner that could still make one would break every machine booting from that tree.
func TestNoVMMTakesAUidItCouldNotReadTheImageWith(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(context.Background(), agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(
		context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	caps := dep.Spec.Template.Spec.Containers[0].SecurityContext.Capabilities
	require.NotNil(t, caps)
	assert.NotContains(t, caps.Add, corev1.Capability("SETUID"),
		"the runner cannot change uid, so smolvm cannot drop a VMM's even if something asked it to")
	assert.NotContains(t, caps.Add, corev1.Capability("SETGID"), "nor the group that goes with it")

	var drop string
	for _, env := range dep.Spec.Template.Spec.Containers[0].Env {
		if env.Name == "SMOLVM_VM_UID_DROP" {
			drop = env.Value
		}
	}
	assert.Equal(t, "off", drop,
		"and the drop is refused in as many words, because a VMM that took one could not read the shared image")
}

// TEST_SCENARIO: smolvm accounts for its own boot in phases, but only when asked — and the runner is the only thing in a position to ask, since it is what spawns it. Without this the phase timings of a stall nobody can reproduce are never recorded at all. The format is asked for too: these lines land in the platform's own logs, where a line of terminal colour codes is a line nobody greps.
func TestTheRunnerAsksSmolvmToAccountForItself(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(context.Background(), agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(
		context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	env := map[string]string{}
	for _, e := range dep.Spec.Template.Spec.Containers[0].Env {
		env[e.Name] = e.Value
	}
	assert.Equal(t, "info", env["RUST_LOG"],
		"or a slow boot reports no phases, and debug would bury them under every status call")
	assert.Equal(t, "json", env["SMOLVM_LOG_FORMAT"], "and the platform's logs stay machine-readable")
}
