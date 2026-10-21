// TEST_OVERVIEW: the vm backend runs the agent as a persistent machine on the VM runner instead of a StatefulSet. The controller must hand the node everything the guest needs to be a platform agent (the gateway proxy env, the MITM CA, the persisted paths, an egress allowlist of exactly the paired gateway), publish the machine into the cluster as the agent Service so the api-server dials it like a pod, mirror the machine's readiness onto the Agent status, stop the machine when the agent should not run, and delete it with the agent.
package reconciler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

type fakeNode struct {
	mu          sync.Mutex
	specs       map[string]vmrunner.MachineSpec
	statuses    map[string]vmrunner.MachineStatus
	deleted     []string
	seedGone    []string
	puts        []vmrunner.MachineSpec
	version     uint64
	waits       int
	statusFails bool
	release     vmrunner.RunnerRelease
	// UNIT_BOUNDARY_DESCRIPTION: every release the controller named over the machine API, in order. A named release becomes the reported target, as the loader reports it once it reads the name.
	named  []string
	onName func()
	usage  vmrunner.RunnerUsage
	// UNIT_BOUNDARY_DESCRIPTION: what the fake runner answers to a read of its image cache: reachable unless a test says otherwise, and the refusal it reports when it is not.
	imageCache vmrunner.RunnerImageCache
	// UNIT_BOUNDARY_DESCRIPTION: the image-cache read answers a 500, as a runner that cannot be asked about its cache does, which is not the same as a runner that says its cache is unreachable.
	imageCacheFails bool
	onPut           func(vmrunner.MachineSpec)
	// UNIT_BOUNDARY_DESCRIPTION: what the controller this test builds asked the runner, so a test can hold a reconcile or a memory pass to the reads it costs: one status read per machine is work a usage read that lists every machine already answers.
	statusReads int
	usageReads  int
	// UNIT_BOUNDARY_DESCRIPTION: answers the usage read a runner release older than the per-machine memory figures did, which lists each machine without them and without the mark that says they are there.
	legacyUsage bool
	// UNIT_BOUNDARY_DESCRIPTION: a status read holds the runner's lock nowhere while it runs, so a test can hold one answer back and let a reconcile record the runner's next answer meanwhile.
	onGet func(id string)
	// UNIT_BOUNDARY_DESCRIPTION: the usage read answers from the machines it listed before the test was told, so a test can hold the answer back and let a reconcile record the runner's next answer meanwhile.
	usageHook func()
	// UNIT_BOUNDARY_DESCRIPTION: every ensure is refused with a 500, as a runner release that runs but cannot manage machines refuses them.
	refusesEnsures bool
	// UNIT_BOUNDARY_DESCRIPTION: the next pressure read fails with a 500, as a runner restarting answers one, and the reads after it answer with the pressure the test set.
	pressureFails bool
	// UNIT_BOUNDARY_DESCRIPTION: the usage read answers a 500, as a runner whose read failed does.
	usageFails bool
	// UNIT_BOUNDARY_DESCRIPTION: how many pressure reads arrived, so a test holds a watch to asking the runner again rather than ending on a failed read.
	pressureReads int
	pressure      vmrunner.RunnerPressure
	// UNIT_BOUNDARY_DESCRIPTION: a stop answers stopping, as the real runner's does, and the machine stays so until a test sets it stopped. Without it a stop takes effect at once.
	stopsSlowly bool
	// UNIT_BOUNDARY_DESCRIPTION: the release read answers a 500, as a loader that hangs answers none, and how many reads arrived, so a test tells a refused read from one that never happened.
	releaseFails bool
	releaseReads int
}

// UNIT_BOUNDARY_DESCRIPTION: how long the fake holds a waiting status read before answering with no change. It is far below the real runner's wait, so a test's server closes promptly under a watch that is still reading.
const fakeNodeWait = 20 * time.Millisecond

func newFakeNode(t *testing.T) (*fakeNode, *httptest.Server) {
	n := &fakeNode{
		specs:      map[string]vmrunner.MachineSpec{},
		statuses:   map[string]vmrunner.MachineStatus{},
		imageCache: vmrunner.RunnerImageCache{Socket: "/var/lib/platform/images/.cache.sock"},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer node-token" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		n.mu.Lock()
		defer n.mu.Unlock()
		if r.URL.Path == "/release" && r.Method == http.MethodPost {
			var named vmrunner.RunnerReleaseName
			require.NoError(t, json.NewDecoder(r.Body).Decode(&named))
			n.named = append(n.named, named.Release)
			if n.release.Target != named.Release && n.release.Running != named.Release {
				n.release.Target = named.Release
			}
			if n.onName != nil {
				n.onName()
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.URL.Path == "/release" {
			n.releaseReads++
			if n.releaseFails {
				http.Error(w, "the read failed", http.StatusInternalServerError)
				return
			}
			require.NoError(t, json.NewEncoder(w).Encode(n.release))
			return
		}
		if r.URL.Path == "/usage" {
			n.usageReads++
			if n.usageFails {
				http.Error(w, "the read failed", http.StatusInternalServerError)
				return
			}
			usage := n.usage
			usage.Machines = n.usageMachines()
			usage.MachineFigures = !n.legacyUsage
			if hook := n.usageHook; hook != nil {
				n.mu.Unlock()
				hook()
				n.mu.Lock()
			}
			require.NoError(t, json.NewEncoder(w).Encode(usage))
			return
		}
		if r.URL.Path == "/pressure" {
			n.pressureReads++
			if n.pressureFails {
				n.pressureFails = false
				http.Error(w, "the read failed", http.StatusInternalServerError)
				return
			}
			require.NoError(t, json.NewEncoder(w).Encode(n.pressure))
			return
		}
		if r.URL.Path == "/image-cache" {
			if n.imageCacheFails {
				http.Error(w, "the read failed", http.StatusInternalServerError)
				return
			}
			require.NoError(t, json.NewEncoder(w).Encode(n.imageCache))
			return
		}
		if r.URL.Path == "/machines" {
			ids := []string{}
			for id := range n.specs {
				ids = append(ids, id)
			}
			require.NoError(t, json.NewEncoder(w).Encode(ids))
			return
		}
		id := r.URL.Path[len("/machines/"):]
		if seeded, ok := strings.CutSuffix(id, "/seed"); ok && r.Method == http.MethodDelete {
			n.seedGone = append(n.seedGone, seeded)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		switch r.Method {
		case http.MethodPut:
			if n.refusesEnsures {
				http.Error(w, "the release cannot manage this machine", http.StatusInternalServerError)
				return
			}
			var spec vmrunner.MachineSpec
			require.NoError(t, json.NewDecoder(r.Body).Decode(&spec))
			n.specs[id] = spec
			n.puts = append(n.puts, spec)
			if n.onPut != nil {
				n.onPut(spec)
			}
			st, ok := n.statuses[id]
			if !ok {
				n.version++
				st = vmrunner.MachineStatus{State: vmrunner.StateCreating, Port: 31000, Version: n.version}
				n.statuses[id] = st
			}
			if ok && !spec.Running && !machineStopped(st) && st.State != vmrunner.StateStopping {
				n.version++
				st.State, st.Ready, st.Version = vmrunner.StateStopped, false, n.version
				if n.stopsSlowly {
					st.State = vmrunner.StateStopping
				}
				n.statuses[id] = st
			}
			require.NoError(t, json.NewEncoder(w).Encode(st))
		case http.MethodGet:
			// UNIT_BOUNDARY_DESCRIPTION: every short status read fails while the runner is handing off, and answers once it recovers; the watch's own long poll is untouched.
			if n.statusFails && !r.URL.Query().Has("wait") {
				http.Error(w, "the read failed", http.StatusInternalServerError)
				return
			}
			if !r.URL.Query().Has("wait") {
				n.statusReads++
			}
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
			st, ok := n.statuses[id]
			if !ok {
				st.State = vmrunner.StateAbsent
			}
			if hook := n.onGet; hook != nil {
				n.mu.Unlock()
				hook(id)
				n.mu.Lock()
			}
			require.NoError(t, json.NewEncoder(w).Encode(st))
		case http.MethodDelete:
			n.deleted = append(n.deleted, id)
			delete(n.specs, id)
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	t.Cleanup(srv.Close)
	return n, srv
}

// UNIT_BOUNDARY_DESCRIPTION: the machines a usage read lists, built from the statuses the runner holds as its own read builds them from what it recorded, without their memory figures when the runner is older than them.
func (n *fakeNode) usageMachines() []vmrunner.MachineUsage {
	out := []vmrunner.MachineUsage{}
	for id, st := range n.statuses {
		m := vmrunner.MachineUsage{ID: id, State: st.State, UsedMiB: st.UsedMiB, DiskGiB: st.DiskGiB}
		if !n.legacyUsage {
			m.CPUs, m.MemoryMiB, m.Warming = st.CPUs, st.MemoryMiB, st.Warming
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// UNIT_BOUNDARY_DESCRIPTION: forgets the reads so far, so a test measures one pass.
func (n *fakeNode) forgetReads() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.statusReads, n.usageReads = 0, 0
}

// UNIT_BOUNDARY_DESCRIPTION: stores a machine's status under a new version, as the runner moves the version on every change it reports.
// UNIT_BOUNDARY_DESCRIPTION: the short status reads fail while the runner hands off, and answer again once it is back.
func (n *fakeNode) failStatusReads(failing bool) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.statusFails = failing
}

// UNIT_BOUNDARY_DESCRIPTION: every ensure the controller sent, as the runner received it.
func (n *fakeNode) ensures() []vmrunner.MachineSpec {
	n.mu.Lock()
	defer n.mu.Unlock()
	return append([]vmrunner.MachineSpec(nil), n.puts...)
}

func (n *fakeNode) set(id string, st vmrunner.MachineStatus) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.version++
	st.Version = n.version
	n.statuses[id] = st
}

// UNIT_BOUNDARY_DESCRIPTION: makes the node an older runner that already holds the machine and reports no disk size, so the disk is sized from the Agent's spec.
func (n *fakeNode) holdsOnAnOlderRelease(id string) {
	n.set(id, vmrunner.MachineStatus{State: vmrunner.StateStopped})
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

func (n *fakeNode) pressureReadCount() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.pressureReads
}

// UNIT_BOUNDARY_DESCRIPTION: the release read fails from now on, as a loader that hangs answers none.
func (n *fakeNode) refuseReleaseReads() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.releaseFails = true
}

func (n *fakeNode) releaseReadCount() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.releaseReads
}

// UNIT_BOUNDARY_DESCRIPTION: sets the pressure the runner reports and makes its next read fail, as a runner restarting does.
func (n *fakeNode) pressureAfterAFailedRead(p vmrunner.RunnerPressure) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.pressure, n.pressureFails = p, true
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

// TEST_SCENARIO: the runner resolves nothing — the node's image cache service fetches its images and it reaches its gateways by ClusterIP — and its egress policy admits no resolver. Its pod keeps the node's resolver rather than the cluster's, so a runner a controller from before the node cache was the only cache rendered is not rolled for it.

// TEST_SCENARIO: a runner that is stopped waits up to thirty seconds for machine actions that cannot be cut short, beside a short drain of its API, and then up to forty seconds while it stops its running machines. With kubelet's default thirty-second grace it would be killed with its guests' disks unquiesced, so the pod is given room for all of it.

// TEST_SCENARIO: smolvm enforces a machine's egress allowlist inside the VMM, the process an escaped guest would own, and the runner runs as uid 0. So the runner pod runs in a user namespace: uid 0 there is an unprivileged uid on the node, and its capabilities stop at the namespace.

// TEST_SCENARIO: an owner's runner cannot be placed — no node advertises the KVM devices, or a namespace-wide node selector excludes the ones that do. The Deployment only ever says zero ready replicas, so without the pod's own account the agent reads "still starting" forever and nobody learns why.

// TEST_SCENARIO: the node an owner's runner pod sits on is gone or has been not ready past the kubelet's eviction toleration. The pod stays terminating there, its claim stays attached to it, and the replacement pod never gets the volume — so every agent of that owner is down until an operator brings the node back or fences it out of service. That is not a runner still starting: the agent says so under a reason of its own.

// TEST_SCENARIO: a node's Ready goes off for a kubelet stall, a network blip or a runtime restart, and the pod stays on it; the node comes back with the pod inside the kubelet's eviction toleration. That heals, so it is not a loss: the agent keeps reading "still starting", its wakes wait out the budget instead of failing at once, and no Warning Event is written. A node not ready past the grace has begun evicting its pods, and a pod the cluster has begun deleting on a node it cannot reach is the eviction that never finishes, so both read as lost — while a pod terminating on a node that reports ready is a pod on its way out normally.

// TEST_SCENARIO: a lost node leaves a finished pod behind as well as a terminating one. A pod that has finished is not the owner's runner, so it must not speak over the replacement: the claim the replacement cannot attach, or the schedule it cannot get, is what the agent shows. A pod still terminating on that node does speak, because it is what keeps the claim.

// UNIT_BOUNDARY_DESCRIPTION: the reason on the agent's PodReady condition, as an operator reads it.
func podReadyReason(t *testing.T, r *AgentReconciler) string {
	t.Helper()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	reason := ""
	for _, c := range conds {
		if m, ok := c.(map[string]interface{}); ok && m["type"] == apiv1.ConditionAgentPodReady {
			reason, _ = m["reason"].(string)
		}
	}
	return reason
}

// TEST_SCENARIO: a new owner's runner pod is created together with its state claim, so the scheduler first reports the claim unbound while the volume is still provisioned. That is a runner still starting, not a failed start the user's first agent shows as an error.
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

const testRunnerPodIP = "10.244.1.7"

// UNIT_BOUNDARY_DESCRIPTION: the ready pod behind the ready runner Deployment. A runtime migration's copy Job pins its address; it has no node, so nothing resizes it.
func readyRunnerPod() *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner-" + runnerSuffix(testOwner) + "-pinned", Namespace: "test-agents", Labels: vmRunnerSelector(testOwner)},
		Status: corev1.PodStatus{
			PodIP:      testRunnerPodIP,
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}},
		},
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
	r, _ := setupReconciler(t, agent, leafSecret(), readyRunnerDeployment(), readyRunnerPod(), runnerSecret(), runnerTLSSecret())
	r.config.VM = config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{
		Image: "quay.io/dam-agents/vm-runner:1", Storage: "100Gi", ReserveMiB: 512, HeadroomMiB: 256, MachineCPUs: 4,
		ServiceAccountName: "platform-vm-runner", ImageCacheBudget: "50Gi", ImageCacheHostPath: "/var/lib/platform-images",
		ReleaseHostPath: "/var/lib/platform-runner-releases",
	}}
	r.runnerEndpoint = func(string) string { return srv.URL }
	requeued := &requeueLog{}
	r.WithRequeue(t.Context(), requeued.add)
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

// TEST_SCENARIO: an Agent with no pull Secret, on an install with no default, fetches anonymously. That was the only behaviour before, and it must stay the same, with no empty credential document on the wire.

// TEST_SCENARIO: a vm agent wakes: the node gets a running machine with the install's vCPUs, sized by the agent's spec where the runner has no memory limit, and its mounts, wired to its gateway alone and carrying the restart revision; the cluster gets an agent Service that selects the owner's runner and maps the agent port onto the one this machine publishes there, and no agent StatefulSet; the Agent reads not-ready until the guest answers, and since no pod event will come the reconciler watches the machine itself.

// TEST_SCENARIO: a vm machine boots one image for every harness, so the Agent's spec.harness reaches the guest as PLATFORM_HARNESS to pick which one runs. The owner's secretRef is applied after it and may override it, as it may any env in the owner's own sandbox. An Agent with no harness sets nothing, leaving the image's default.

// TEST_SCENARIO: the guest's runtime offers the browser panel only on an Agent that requires named connections, so the machine is told which with PLATFORM_REQUIRE_CONNECTION_ADDRESS. It is set after the owner's secretRef is applied, unlike PLATFORM_HARNESS, so the owner's own secret cannot claim the panel for an Agent that does not require named connections.

// TEST_SCENARIO: on a laptop the runner runs on the host, outside the cluster, and serves every owner. The guest reaches its gateway through a NodePort the cluster's VM forwards to the host's loopback, at the address smolvm gives the host, and at nothing else — so the machine carries that port instead of an allowlist, since allowing the host address would open every loopback port. The agent's Service has no runner pod to select and names the host and the machine's published port in its own EndpointSlice, and a delete reaches the host runner with no runner Deployment to look for.

// TEST_SCENARIO: the host runner serves every owner, so the api-server can show a laptop's pools only if the controller writes a usage Secret for it too. There is one runner, so there is one Secret, holding the host address, the runners' CA and a usage capability, and it names no owner: each owner's reconcile writes the same Secret, and an owner label would flip between them.

// TEST_SCENARIO: an install switched from runner pods to the host runner still holds the runner Deployment it made for an owner before, whose pod can never schedule without a KVM device. The host-mode sweep removes that Deployment and keeps its claim, which holds the disks of the machines it ran, and leaves the host runner's own Secret, whose name a per-owner lookup would resolve to in host mode, alone.

// TEST_SCENARIO: a machine on its way up is watched with a long poll on its runner, not by running the whole reconcile twice a second. However often the Agent reconciles, it has one watch; while the status holds still nothing is requeued; and the moment the status changes — the guest answering — the Agent is requeued at once, and the watch ends so the reconcile that follows can publish the change.

// TEST_SCENARIO: a watch belongs to a machine on its way up and ends with it. Hibernating the Agent once its machine has stopped, or deleting it, ends the watch without a requeue, since whatever did that reconciles the Agent itself; a machine that failed is not watched, and waits for the health poll.

// TEST_SCENARIO: a watch runs outside any reconcile, so it must end with the leadership that owns the queue. When the reconciler's lifetime ends — the controller shutting down, or losing the lease — the long poll is abandoned and nothing is requeued onto a queue that is being shut down.

// TEST_SCENARIO: the runner's pressure read is the controller's only view of the kernel's, and a settled agent no longer reconciles every minute to start a watch that ended. A read that fails — the runner restarting, a connection dropped — is asked again by the watch itself, before any reconcile and before the five-minute sweep, and the watch goes on asking once the runner answers.

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
			Labels: map[string]string{"controller-revision-hash": "rev-1", LabelAgent: "my-agent"}},
		Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}},
	}
	_, err = r.client.CoreV1().Pods("test-agents").Create(ctx, pod, metav1.CreateOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: a waking gateway pod takes longer to start than the machine beside it, so a wake scales the gateway up before the runner is asked to start the machine, not after the runner answers.

// TEST_SCENARIO: the retry of an agent the runner refused must not scale its gateway up ahead of the runner call either, or each 30 s retry would start and stop a gateway pod. The refusal is also the runner's answer rather than a line on the Agent, so it counts before the status carries it, and the answer that admits the machine replaces it: a machine the runner admits counts while it boots, before it is a live machine to count by.

// TEST_SCENARIO: a restart the runner is running holds its exemption from the ceiling, but a runner built before that still answers the wait when the controller's ensure lands between the stop and the boot. Acting on that answer by parking would stop the machine behind the restart the runner already performs, and the owner's machines would be left down for a ceiling nothing asked for.

// TEST_SCENARIO: the controller's own reading is kept from the last time a machine ran, so a guest that has exited since still reads as running there. Admitting on that reading turns a genuine cold start into one with no ceiling, which is the overcommit the ceiling exists to prevent. What a machine holds is only ever the runner's current answer.

// TEST_SCENARIO: a revision restart is admitted and blocked between stopping the old VMM and booting its replacement, and the state read fails transiently before the runner answers again. Acting on the failed read with no state parks the Agent, and the halt that follows is stored behind the restart: the replacement is stopped once it boots. A failed read is no evidence, so the reconcile is retried and nothing is stopped.

// TEST_SCENARIO: the runner says it cannot read the machine's own launch record, which is a machine that may still hold the memory of a VMM it cannot account for. Absence of an active spelling is not proof of a stop, so the reconcile is retried rather than held, parked or admitted.

// TEST_SCENARIO: a node that reports nothing it holds for the owner's runner leaves the grant unreadable, and what that means has to come from the runner: a machine it reports running holds memory, so admitting it against the limit alone asks for no footprint the node has not already granted, and a start held here would stop a healthy machine rather than a boot. The controller's own last reading cannot tell: it is kept only while a machine runs, so a restart in flight reads as a stop there.

// TEST_SCENARIO: a machine that holds memory is re-sent while the node reports no grant, and its ceiling authorizes no footprint at all. Zero would be the whole pool: the machine can stop between this read and the ensure, and the runner would then boot a cold start against memory the node never reserved. One MiB is the tightest ceiling the wire carries, and no boot of a machine that holds memory fits under it.

// TEST_SCENARIO: nothing the controller remembers about a grant survives to a later decision. A figure the node reported before can be larger than what the node reserves now — the machines warm up, the request falls, the node enacts a smaller allocation — so a ceiling derived from history admits a cold start against memory the node has since released. Every ensure decides on the node's current answer alone.

// TEST_SCENARIO: the withdrawal of the ceiling must not depend on which runner is serving. A runner from before the operation exemption answers the ensure of a boot already in flight with the allocation wait, and the controller used to answer that by parking the Agent — which stops the machine the runner was bringing up. Nothing is parked for a machine that is still coming up, so such a boot completes and the next reconcile reads it running.

// TEST_SCENARIO: a start that holds nothing is still parked. The exemption is for machines that hold memory, and a stopped one waiting for the node is exactly the start this ceiling exists to hold.

// TEST_SCENARIO: a restart boots its replacement, so while the node's grant is unreadable the machine reads restarting and holds the memory its boot takes again. Halting it stops the restart the ceiling left exempt.

// TEST_SCENARIO: a start waiting for the node is retried every few seconds, so its gateway must not be scaled up and taken down on that cadence either: the machine is refused again until the node enacts the resize, and the gateway comes up on the retry after it starts.

// TEST_SCENARIO: on a wake the machine often answers before its gateway pod is ready, and the gateway pod turning ready starts a reconcile. That reconcile publishes Ready once the gateway is applied, before it calls the runner, because the status already holds the machine ready for this generation.

// TEST_SCENARIO: the early publish trusts the agent side only for the generation it was published for. After a spec change the reconcile must ask the runner first, so Ready waits for the full publish.

// TEST_SCENARIO: a hard stop must reach the machine: the node is told the machine should not run, and the gateway pair scales down as for any agent.

// TEST_SCENARIO: deleting the Agent deletes the machine and its disk on the node — the only place a vm agent's workspace lives.

// TEST_SCENARIO: the delete queue retries a cleanup for three quarters of an hour, so it can run long after the delete, and an Agent created again under that name owns the machine, the home and the objects by then. The UID the delete carried tells the two apart: the cleanup waits while the same Agent still holds the name, and removes nothing once another one does.

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

// TEST_SCENARIO: an Agent whose labels were never seen, the informer having lost its last state, still has a machine somewhere, so a delete without an owner is offered to every runner.

// TEST_SCENARIO: the controller reconciles different owners' agents on different workers at once. A runner that hangs but keeps its listener holds its owner's reconcile for the runner client's timeout, and nothing the reconciler shares across owners may be held across that call, or another owner's wake waits on it anyway.

// TEST_SCENARIO: the sweep needs every runner's token and CA, and runs every ten minutes over every owner. Both of a runner's Secrets carry the component label — the token by the controller, the TLS Secret by cert-manager from the Certificate's template — so one List serves them all and no Secret is read by name.

// TEST_SCENARIO: the guest's MITM CA comes from the same leaf Secret the pod mounts; until cert-manager issues it there is nothing to boot with, so the reconcile requeues instead of creating a machine that cannot trust its gateway.

// TEST_SCENARIO: an install without a VM runner cannot run vm agents; the Agent says so instead of silently running as a container.

// TEST_SCENARIO: two owners' vm agents: each owner's machines land on a runner of their own — a separate Deployment, disk and credentials — so one owner's guest cannot reach another's, and the runner's ingress policy admits only the platform.

// TEST_SCENARIO: an install has virtualization on but the agent hibernating is container-backed; halting must not reach a runner, because that agent has no machine and an error here would strand its credentials.

// TEST_SCENARIO: the disk carries a size that does not parse; the reconcile fails instead of booting the guest on the 1 GiB floor, which would look healthy and run out of disk later.

// TEST_SCENARIO: a machine has one disk, so the Agent's own storage size is the whole of it. The container backend's mounts cannot say that — each is a volume with a size of its own — so summing them bought a number no single path was held to, and rounding each up to a GiB first paid for that rounding once per mount. Here two persisted mounts of 4Gi each are one 10Gi disk.

// TEST_SCENARIO: a vm agent has no disk size of its own. A machine its runner does not hold yet is created at the owner's whole storage pool, whatever release the runner is, since every release creates a disk at the size it is asked for; booting at the chart's legacy size would leave it there until its next start.

// TEST_SCENARIO: an existing machine whose runner reports no disk size may be on an older release, which would reboot a running machine to grow it, so it keeps the Agent's own size. Once the runner reports the machine's disk, which only a runner that grows a disk at the next start does, the machine is asked for the owner's pool.

// TEST_SCENARIO: the api-server reads an owner's runner with what the usage Secret holds: the runner's URL, the CA its certificate chains to, and a usage capability. It must never hold the token, which drives every route of the machine API, nor the runner's TLS key.

// TEST_SCENARIO: the default template's mounts — HOME persisted, /tmp not — are what every shipped template and starter kit declares, and they are exactly what a machine already does: HOME on the disk, everything else discarded with the root at the next stop. So the common case reconciles with nothing to decide.

// TEST_SCENARIO: a machine keeps HOME and nothing else, so a mount asking to persist a path outside it cannot be honoured. Dropping it silently is the failure this backend exists to stop being possible — the agent would run, look healthy, and lose that path the first time it stopped — so the reconcile fails and says where the path would have to move.

// TEST_SCENARIO: a mount's own size wins over the Agent's storageSize on the container backend, so a spec that asks for 50Gi there must not quietly get the chart's default here. The machine has one disk, so the largest thing any persisted mount asks for is what it is sized to — the one field of Mount this backend could still drop without saying so.

// TEST_SCENARIO: images/ is the node cache the install's runners on a node share, never a directory of the runner's claim, so it gets a mount of its own, read-only, from the host directory the install names. The other two always live on the claim and are mounted by subPath, so the claim's root is never exposed.

// TEST_SCENARIO: the runner reaches the node's image cache service through a socket the chart's DaemonSet binds inside the same directory. The controller and the chart each name that path, so the controller's constant must be the one the chart passes, or every runner refuses every image as unavailable.

// TEST_SCENARIO: the node cache carries a budget, because a node directory is shared with the rest of the host and cannot be given a share of its filesystem. A budget the controller cannot read fails the reconcile rather than being replaced by a guess, which would be a cache growing until the node runs out.

// TEST_SCENARIO: the runner now sits in the agent namespace while the api-server and controller stay in the release namespace, so its ingress peers have to name that namespace — a bare pod selector matches only the policy's own namespace, which would admit nobody and strand every vm agent. The one peer that does sit in the agent namespace is the owner's own runtime-migration Job.

// TEST_SCENARIO: the scrape port carries no token, so the NetworkPolicy is its only gate — it must admit the platform's collector to that port alone, and nothing else may reach it, while the collector reaches nothing but it.

// TEST_SCENARIO: the release is not called `platform`, so the chart's fullname and the Helm release name diverge; the runner's ingress policy must still select the api-server and controller pods, which carry the release name — selecting on the fullname would admit nobody and strand every vm agent.

// TEST_SCENARIO: nothing answers the owner's machine API — the case every owner's first vm agent starts in, before its runner exists. The resize gate guards a machine that is already running, so with no such machine it must allow; refusing wedges the very reconcile that would build the runner.

// TEST_SCENARIO: switching virtualization off and on deletes the runner ServiceAccount and renders a new one, which carries a new UID. A controller that resolved the owner once would keep stamping the dead UID, and every object it wrote would be collected the instant it appeared — a runner that never shows up and never explains why.

// TEST_SCENARIO: Helm never sees a runner — the controller creates it — so nothing would remove one on uninstall, on rollback, or when virtualization is switched off. Every object it creates is owned by the ServiceAccount the chart does render, which sits in the same namespace because an owner reference may not cross one; a single object missing the reference strands a running VM. The claim is the exception: it holds every machine disk of the owner, so one deletion of the account must not collect it.

// TEST_SCENARIO: the owner's Agents no longer look like vm agents, yet a machine is still running on their runner. Deleting the runner takes that owner's whole disk with it, so it is re-read first and kept while it still holds anything.

// TEST_SCENARIO: the runner refuses a machine for want of memory; the agent parks instead of spinning — the gateway scales to zero so the owner stops being charged for an agent that does not exist, and the status says in the owner's terms that their VM agents' memory is full and what frees it, not the runner's own accounting.

// TEST_SCENARIO: a start the node has not yet granted the memory for is refused under MachineAwaitingAllocation, which is not the owner's memory being full: the controller asks the node for that memory with an in-place resize in the same reconcile, so the Agent is retried at the machine watch's 3 s cadence rather than at the parked tick, no idle agent is hibernated for room the node is already being asked for, and the person reads that their agent is waiting for the node rather than that their memory is gone.

// TEST_SCENARIO: the node that keeps a runner at its old size is one no wait ends on: it has deferred the resize, so the room the pod was given is all the owner will get until their machines stop. The start frees that room from the owner's own idle agents, as a start the pool refused does, and the parked retry is the backstop under the machine watch's cadence. The room to free is what the node holds for the runner, not the pool: the pool has room, or the runner would have refused the start for it instead.

// TEST_SCENARIO: two wakes that become AwaitingAllocation together are both counted by the resize request, and neither holds a byte: counting the other waiter as a holder asks the reclaim for room no idle agent can give, so neither start is ever admitted even though one machine's worth of room would admit it.

// TEST_SCENARIO: a runner outside the cluster refuses a machine for memory; its limit is a share of its host's memory the controller never learns, so the refusal names no figures rather than quote the chart's limit.

// TEST_SCENARIO: a runner whose claim is full refuses a machine under MachineStorageFull, which is not the memory refusal. The Agent is not parked, since parking halts a machine, and the runner's explanation reaches the AgentPodReady condition the api-server classifies a wake by.

// TEST_SCENARIO: a runner that cannot reach the node's image cache refuses every image its machines do not already hold, and the runner sees only its own mount of the cache directory — two runners on one node directory and on a stale copy of it name the same socket. So the Agent's own failure names the node directory this runner mounts, which is the fact an operator compares with the one the cache service writes: a start that fails with no pending runner change writes no roll Event to carry it.

// TEST_SCENARIO: a full home inside a guest is the same failure a container agent reports from its termination message, so the runner's reason for it is published as HomeVolumeFull, and the api-server's and UI's existing copy for a full home applies to a vm agent too.

// TEST_SCENARIO: an agent that was down before the runner's kill carried a condition flip from long before it, and a publish that changes only the reason moves no transition time — so a kill timed from that flip would be outside its episode on the first read, and the agent would name the kill on one reconcile and its own reason on the next, all the way through the episode. The reason carries the time it was first published instead, so the reconcile after it still reads the kill.

// TEST_SCENARIO: a machine no Agent of this owner claims holds guest memory forever, so the sweep deletes it — and ownership is part of the match, because an Agent of the same name belonging to someone else says nothing about this runner's machine.

// TEST_SCENARIO: hibernating a vm agent has to stop its machine, which is how the platform reclaims a runner's memory — scaling the gateway alone would leave the guest running while the owner's budget counts that memory as free.

// TEST_SCENARIO: a vm agent whose idle timeout lapsed may still be busy, say a Browser Terminal running a long job. Only the idle checker asks agent-runtime, so the reconcile must leave the machine running until the checker has hibernated the pair. Once the gateway is at zero, a machine the checker could not stop is stopped by the next reconcile.

// TEST_SCENARIO: the controller trusts a runner by the CA that issued its certificate, so the certificate has to name the Service the controller dials, come from the runners' own CA issuer and never the gateways' MITM one — whose leaves name hosts users choose — and label its Secret so the sweep finds it. A TLS Secret with no CA in it must be refused, because an empty trust pool silently falls back to the system roots.

// TEST_SCENARIO: a new owner's runner cannot serve until cert-manager issues its certificate, and its pod cannot mount the Secret before then. The reconcile requeues, as it does for a gateway's leaf, rather than marking the Agent failed, and no machine is asked for.

// TEST_SCENARIO: the policy confines the runner pod as well as admitting callers, which is the only kernel gate behind a guest's egress allowlist — smolvm enforces that allowlist inside the process an escaped guest would already own. The runner dials nothing but its owner's gateways, so that is all it may reach: no other address, and no resolver, since port 53 open anywhere is a two-way channel from an escaped guest to any host that answers there.

// TEST_SCENARIO: a runner hosts untrusted guests, so its container holds only the capabilities it adds and none of the runtime's defaults, cannot raise them through exec, and runs under the runtime's default seccomp profile. AppArmor stays unconfined, because the runtime's default profile keeps every guest from booting.

// TEST_SCENARIO: the runner's token is the machine API's credential, so it is 256 bits from the operating system's generator, and two runners never share one.

// TEST_SCENARIO: an agent the runner refused is parked and retried every 30s, so the gateway must not be brought up and taken down on that cadence — a scheduled and killed pod each cycle, for an agent that cannot run.

// TEST_SCENARIO: a runner roll, a controller restart or a schedule retry brings an owner's agents back with no fresh activity bump, and the runner refuses the ones that do not fit while the others warm up. Nobody presses Start again for those, so the refusal is not remembered against the wake: the retry tick reconciles the agent under the same activity, and it starts once room has freed.

// TEST_SCENARIO: the node's image cache service unpacks every image, so no runner holds the CHOWN, FOWNER and FSETID an unpack takes. Every runner holds DAC_OVERRIDE for its VMMs, which read the image tree with the runner's own credentials to serve it to the guest, including files the image keeps from root, and SYS_RESOURCE so the two processes of the pod can lower their own OOM score where the node lets them: without it a runner holding a few pages of a booting guest's memory ties with a VMM at the maximum, and the kernel's tie-break is the whole protection.

// TEST_SCENARIO: service links would put one set of env vars per sibling agent Service into the runner, and the runner reads none of them.

// TEST_SCENARIO: a runner with no ready replica reports nothing about its machines, so the reconcile gets an empty machine status. The runner keeps its restart counter in memory and reports it again once it is back. Publishing the empty status as zero restarts would make that return read as a rise, and the UI would announce a restart that never happened.

// TEST_SCENARIO: smolvm would give each machine's VMM an unprivileged uid of its own, and this runner refuses it, because a VMM that took one reaches what the runner shares with it through an idmapped mount of a single entry — on-disk uid 0 — so every file the image gives another uid arrives as nobody and the workload exits at once; machines whose rootfs came from a per-machine archive failed to finish starting under the drop as well. The refusal is stated in the environment and backed by withholding the capabilities a uid change needs, since a runner that could still make one would break every machine booting from that tree.

// TEST_SCENARIO: smolvm accounts for its own boot in phases, but only when asked — and the runner is the only thing in a position to ask, since it is what spawns it. Without this the phase timings of a stall nobody can reproduce are never recorded at all. The format is asked for too: these lines land in the platform's own logs, where a line of terminal colour codes is a line nobody greps.

// TEST_SCENARIO: smolvm checks a VMM against the syscalls a running microVM needs only when its embedder asks, and the runner is the embedder. It asks for enforce, so a VMM that makes a call outside the allowlist is killed.

// TEST_SCENARIO: an install switches its VMMs' syscall filter to audit, or back, through its values, without a release.

// TEST_SCENARIO: smolvm confines a VMM's filesystem only when its embedder asks, and the runner is the embedder. Unconfined, a guest writes through its root virtiofs export into the agent rootfs every sibling machine boots from.

func envSecret(t *testing.T, r *AgentReconciler, name string, labels map[string]string) {
	t.Helper()
	_, err := r.client.CoreV1().Secrets("test-agents").Create(context.Background(), &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "test-agents", Labels: labels},
		Data:       map[string][]byte{"SECRET_TOKEN": []byte("s3cr3t-value")},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: a secretRef names a Secret by name alone, in the namespace that holds every owner's credentials and every runner's token, and all of its keys land in the guest's environment. A Secret labelled with the Agent's own owner is honoured; one with another owner's label, with no owner label at all, or one the platform manages is refused: the machine is still ensured, without any of its values, and the reconcile reports the refusal.

// TEST_SCENARIO: an agent already ran with a Secret its owner does not hold — written before the check existed. Refusing the reconcile alone would leave that environment on the workload; the refusal must take it off. A machine ensured with the Secret is ensured again without it.

// TEST_SCENARIO: the container backend hands a secretRef to the kubelet as envFrom, so the same Secret the vm backend refuses must never reach a StatefulSet there either: the pod is rendered without it, which also takes it off a pod that already had it, and the reconcile reports the refusal. An operator's Secret that predates the rule needs only its owner label to work again.

// TEST_SCENARIO: a machine's ca.crt is its gateway's MITM CA followed by the install's extra CAs, each a whole PEM block even when the gateway CA lacks a trailing newline; without extras it is the gateway CA unchanged.

// TEST_SCENARIO: the OOM kill of an owner's runner was reported only on the agents whose runner reason happened to be MachineNotReady, so an agent the restarted runner refused room, or one carrying a reason of its own, told its owner about that consequence and never about the kill — and the OOM notice and the Slack alert read nothing else. Every agent that was already running when the kill happened now names it for the episode that follows, from the runner pod's last termination alone, whatever reason it carries until then; an agent woken inside that episode carries nothing, since the kill did not take it down.

// UNIT_BOUNDARY_DESCRIPTION: a clientset whose Secret reads each take `delay`, outside the fake's own lock, which serialises every call it answers. The time a reconcile takes then counts the Secret reads it makes one after another.
type slowSecretsClient struct {
	*fake.Clientset
	delay time.Duration
}

func (c slowSecretsClient) CoreV1() corev1client.CoreV1Interface {
	return slowSecretsCore{c.Clientset.CoreV1(), c.delay}
}

type slowSecretsCore struct {
	corev1client.CoreV1Interface
	delay time.Duration
}

func (c slowSecretsCore) Secrets(namespace string) corev1client.SecretInterface {
	return slowSecrets{c.CoreV1Interface.Secrets(namespace), c.delay}
}

type slowSecrets struct {
	corev1client.SecretInterface
	delay time.Duration
}

func (s slowSecrets) Get(ctx context.Context, name string, opts metav1.GetOptions) (*corev1.Secret, error) {
	time.Sleep(s.delay)
	return s.SecretInterface.Get(ctx, name, opts)
}

// TEST_SCENARIO: every reconcile of a waking vm agent prepares its owner's runner before it sends the machine spec, and both read Secrets: the runner's token and certificate, and the agent's leaf. Read one after another they were four serial reads; the token and certificate are read side by side, and the leaf beside the runner, so the API server's latency is paid twice.

// UNIT_BOUNDARY_DESCRIPTION: the fake clientset neither sets resourceVersions nor checks them, so a write sent from a stale cache would pass. This stamps a new version on every write of the cached kinds, bumps a StatefulSet's generation on a spec update, and refuses an update whose version is not the stored one, as the API server does.
func versionWrites(client *fake.Clientset) {
	version := int64(100)
	for _, kind := range []string{"statefulsets", "deployments", "pods"} {
		client.PrependReactor("*", kind, func(action k8stesting.Action) (bool, runtime.Object, error) {
			write, ok := action.(interface{ GetObject() runtime.Object })
			if !ok || action.GetVerb() != "create" && action.GetVerb() != "update" {
				return false, nil, nil
			}
			obj, err := apimeta.Accessor(write.GetObject())
			if err != nil {
				return true, nil, err
			}
			if action.GetVerb() == "update" {
				stored, err := client.Tracker().Get(action.GetResource(), action.GetNamespace(), obj.GetName())
				if err != nil {
					return true, nil, err
				}
				current, _ := apimeta.Accessor(stored)
				if obj.GetResourceVersion() != current.GetResourceVersion() {
					return true, nil, k8serrors.NewConflict(action.GetResource().GroupResource(), obj.GetName(), errors.New("the object has been modified"))
				}
				if kind == "statefulsets" && action.GetSubresource() == "" {
					obj.SetGeneration(current.GetGeneration() + 1)
				}
			}
			version++
			obj.SetResourceVersion(strconv.FormatInt(version, 10))
			return false, nil, nil
		})
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the informers the controller runs, with the selectors main.go gives them, started over the fake clientset and wired into the reconciler.
func startCaches(t *testing.T, r *AgentReconciler) {
	t.Helper()
	client := r.client.(*fake.Clientset)
	selected := func(selector string) informers.SharedInformerFactory {
		return informers.NewSharedInformerFactoryWithOptions(client, 0, informers.WithNamespace("test-agents"),
			informers.WithTweakListOptions(func(opts *metav1.ListOptions) { opts.LabelSelector = selector }))
	}
	agents, runners := selected(LabelAgent), selected("app.kubernetes.io/component="+vmRunnerComponent)
	pods, statefulSets := agents.Core().V1().Pods(), agents.Apps().V1().StatefulSets().Informer()
	deployments, runnerPods := runners.Apps().V1().Deployments().Informer(), runners.Core().V1().Pods()
	r.WithPodCache(pods.Lister()).WithStatefulSetCache(statefulSets).WithRunnerCaches(deployments, runnerPods.Lister())
	agents.Start(t.Context().Done())
	runners.Start(t.Context().Done())
	require.True(t, cache.WaitForCacheSync(t.Context().Done(), pods.Informer().HasSynced, statefulSets.HasSynced, deployments.HasSynced, runnerPods.Informer().HasSynced))
}

// UNIT_BOUNDARY_DESCRIPTION: an informer that is never started, so a test puts in it exactly the stale view it needs.
func staleInformer(objType runtime.Object, objs ...runtime.Object) cache.SharedIndexInformer {
	informer := cache.NewSharedIndexInformer(&cache.ListWatch{}, objType, 0, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, obj := range objs {
		_ = informer.GetStore().Add(obj)
	}
	return informer
}

// TEST_SCENARIO: a vm agent that is up is reconciled again and again while it runs — a machine poll, a pod event, a drift sweep. Each of those reconciles read its gateway StatefulSet three to four times, its runner Deployment twice and its runner's pods once, all live, and the runner's token and certificate twice each. The StatefulSet, the Deployment and the runner's pods are served from the informers the controller runs, and each runner Secret is read once, so a steady reconcile reads none of the cached kinds from the API server.

// TEST_SCENARIO: the runner pod cache can hold a pod from before its last change. A resize sent from it carries that old resourceVersion, so the API server refuses it rather than applying it over the change, and the resize is decided again from a live read of the pod.

// TEST_SCENARIO: right after the reconcile updates the gateway's template, the informer still holds the StatefulSet as it was, whose pod is ready on the current revision. A readiness check on that copy would call the gateway ready while it is about to roll, so the reconcile reads its own update, whose generation the StatefulSet controller has not observed yet.

// TEST_SCENARIO: the StatefulSet and its pods come from two caches, so the pod can be the newer of the two: a pod the StatefulSet controller just created on a new revision, not ready yet, looks stuck on a superseded revision against a cached StatefulSet that has not seen the new one. It is deleted only when a live read still finds it stuck.
