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

	"github.com/stretchr/testify/assert"
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
	// UNIT_BOUNDARY_DESCRIPTION: what the fake runner admits against, standing in for the real runner's own arithmetic: a start is admitted only while what the machines hold, plus the start itself, plus the reserve fits under the pod's limit and under the `AdmitMiB` ceiling the controller sent. A machine's count is its size, or the warm-up floor when it is smaller. Every ensure beyond that is refused as `MachineAwaitingAllocation`, which is what a node that has not granted the memory answers.
	admit       bool
	reserveMiB  int
	bootMiB     int
	machineSize map[string]int
	admitCalls  []string
}

// UNIT_BOUNDARY_DESCRIPTION: how long the fake holds a waiting status read before answering with no change. It is far below the real runner's wait, so a test's server closes promptly under a watch that is still reading.
const fakeNodeWait = 20 * time.Millisecond

func newFakeNode(t *testing.T) (*fakeNode, *httptest.Server) {
	n := &fakeNode{
		specs:       map[string]vmrunner.MachineSpec{},
		statuses:    map[string]vmrunner.MachineStatus{},
		machineSize: map[string]int{},
		imageCache:  vmrunner.RunnerImageCache{Socket: "/var/lib/platform/images/.cache.sock"},
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
			// UNIT_BOUNDARY_DESCRIPTION: a start is admitted only while it fits, as the real runner decides it; a start the node has not granted the memory for is answered as waiting for the node, and is not stored, so the controller reads the machine as absent until the grant arrives.
			if n.admit && spec.Running && !fakeHoldsMemory(n.statuses[id]) {
				n.admitCalls = append(n.admitCalls, id)
				if n.fits(id, spec) {
					// UNIT_BOUNDARY_DESCRIPTION: an admitted start replaces the refusal an attempt before left, as the real runner's does once it takes the machine.
					n.version++
					n.statuses[id] = vmrunner.MachineStatus{State: vmrunner.StateCreating, Port: 31000, Version: n.version}
				} else {
					n.version++
					st := vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonAwaitingAllocation, Version: n.version}
					n.statuses[id] = st
					require.NoError(t, json.NewEncoder(w).Encode(st))
					return
				}
			}
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

// UNIT_BOUNDARY_DESCRIPTION: whether a machine the fake runner holds is one a boot replaces rather than one asking for new room.
func fakeHoldsMemory(st vmrunner.MachineStatus) bool {
	switch st.State {
	case vmrunner.StateCreating, vmrunner.StateStarting, vmrunner.StateRunning, vmrunner.StateRestarting, vmrunner.StateStopping:
		return true
	}
	return false
}

// UNIT_BOUNDARY_DESCRIPTION: the real runner's own admission, cut down to the figures a test sets: what every other machine holds, counted at its size or the warm-up floor when that is smaller, plus this start at the same figure, plus the reserve, under the `AdmitMiB` ceiling the controller sent when it sent one.
func (n *fakeNode) fits(id string, spec vmrunner.MachineSpec) bool {
	ceiling := spec.AdmitMiB
	if ceiling <= 0 {
		return true
	}
	count := func(size int) int {
		if n.bootMiB > 0 {
			return min(size, n.bootMiB)
		}
		return size
	}
	held := 0
	for other, size := range n.machineSize {
		if other != id && fakeHoldsMemory(n.statuses[other]) {
			held += count(size)
		}
	}
	n.machineSize[id] = spec.MemoryMiB
	return held+count(spec.MemoryMiB)+n.reserveMiB <= ceiling
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
func readyRunnerDeployment() *appsv1.Deployment {
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "platform-vm-runner-" + runnerSuffix(testOwner),
			Namespace: "test-agents",
			Labels:    map[string]string{"app.kubernetes.io/component": vmRunnerComponent, envoyOwnerLabel: testOwner},
		},
		Status: appsv1.DeploymentStatus{ReadyReplicas: 1, AvailableReplicas: 1},
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
	r.config.VM = config.VMConfig{Runner: config.VMRunnerSpec{
		Image: "quay.io/dam-agents/vm-runner:1", Storage: "100Gi", ReserveMiB: 512, HeadroomMiB: 256, MachineCPUs: 4, MachineMemoryMiB: 2048,
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

func envSecret(t *testing.T, r *AgentReconciler, name string, labels map[string]string) {
	t.Helper()
	_, err := r.client.CoreV1().Secrets("test-agents").Create(context.Background(), &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "test-agents", Labels: labels},
		Data:       map[string][]byte{"SECRET_TOKEN": []byte("s3cr3t-value")},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
}

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

// TEST_SCENARIO: every Agent that existed before this release still carries what the CRD keeps but no code reads — a container backend, a runtime class, a node selector, the copy attempts. Such an Agent must reconcile into exactly the machine a clean one of the same spec gets, and the controller must not rewrite the stale fields, since only the CRD's retirement removes them.
func TestAStaleAgentReconcilesLikeACleanOne(t *testing.T) {
	ctx := context.Background()
	stale := vmAgentCR()
	stale.Spec.Backend = &apiv1.Backend{Type: "container"}
	stale.Spec.RuntimeClassName = "gvisor"
	stale.Spec.NodeSelector = map[string]string{"gpu": "true"}
	stale.Status.RuntimeMigrationAttempts = 3
	staleReconciler, staleNode, _ := setupVMReconciler(t, stale)
	require.NoError(t, staleReconciler.Reconcile(ctx, stale))

	clean := vmAgentCR()
	cleanReconciler, cleanNode, _ := setupVMReconciler(t, clean)
	require.NoError(t, cleanReconciler.Reconcile(ctx, clean))

	assert.Equal(t, cleanNode.spec("my-agent"), staleNode.spec("my-agent"))
	stored, err := staleReconciler.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	backend, _, _ := unstructured.NestedString(stored.Object, "spec", "backend", "type")
	assert.Equal(t, "container", backend, "the stale field stays as the CRD left it")
}
