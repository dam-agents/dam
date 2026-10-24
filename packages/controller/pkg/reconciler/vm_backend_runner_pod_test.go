// TEST_OVERVIEW: the runner pod the controller creates for one owner runs on the sandbox node, resolves through it, and is confined: a user namespace, no service links, a token, and the syscall and filesystem enclosure its VMMs run under.
package reconciler

import (
	"context"
	"encoding/hex"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// TEST_SCENARIO: the runner resolves nothing — the node's image cache service fetches its images and it reaches its gateways by ClusterIP — and its egress policy admits no resolver. Its pod keeps the node's resolver rather than the cluster's, so a runner a controller from before the node cache was the only cache rendered is not rolled for it.
func TestTheRunnerResolvesThroughTheNodeNotTheCluster(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, corev1.DNSDefault, dep.Spec.Template.Spec.DNSPolicy)
}

// TEST_SCENARIO: a runner that is stopped waits up to thirty seconds for machine actions that cannot be cut short, beside a short drain of its API, and then up to forty seconds while it stops its running machines. With kubelet's default thirty-second grace it would be killed with its guests' disks unquiesced, so the pod is given room for all of it.
func TestTheRunnerPodHasRoomToCloseBeforeItIsKilled(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	grace := dep.Spec.Template.Spec.TerminationGracePeriodSeconds
	require.NotNil(t, grace)
	assert.Greater(t, *grace, int64(30+40+5))
}

// TEST_SCENARIO: smolvm enforces a machine's egress allowlist inside the VMM, the process an escaped guest would own, and the runner runs as uid 0. So the runner pod runs in a user namespace: uid 0 there is an unprivileged uid on the node, and its capabilities stop at the namespace.
func TestTheRunnerPodRunsInAUserNamespace(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	require.NotNil(t, dep.Spec.Template.Spec.HostUsers)
	assert.False(t, *dep.Spec.Template.Spec.HostUsers)
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
	r.config.VM = config.VMConfig{Runner: config.VMRunnerSpec{
		Image: "quay.io/dam-agents/vm-runner:1", Storage: "100Gi", ReserveMiB: 512, HeadroomMiB: 256, MachineCPUs: 4,
		ServiceAccountName: "platform-vm-runner", ImageCacheBudget: "50Gi", ImageCacheHostPath: "/var/lib/platform-images",
		ReleaseHostPath: "/var/lib/platform-runner-releases",
	}}
	r.runnerEndpoint = func(string) string { return srv.URL }

	require.NoError(t, r.Reconcile(context.Background(), agent))

	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	msg, reason := "", ""
	for _, c := range conds {
		if m, ok := c.(map[string]interface{}); ok && m["type"] == apiv1.ConditionAgentPodReady {
			msg, _ = m["message"].(string)
			reason, _ = m["reason"].(string)
		}
	}
	assert.Equal(t, apiv1.ReasonMachineRunnerUnschedulable, reason, "a runner that cannot be placed is a failed start, not one still coming up")
	assert.Contains(t, msg, "cannot be scheduled")
	assert.Contains(t, msg, "Insufficient devices.kubevirt.io/kvm",
		"the scheduler's own account reaches the agent, not just the generic starting message")
}

// TEST_SCENARIO: the node an owner's runner pod sits on is gone or has been not ready past the kubelet's eviction toleration. The pod stays terminating there, its claim stays attached to it, and the replacement pod never gets the volume — so every agent of that owner is down until an operator brings the node back or fences it out of service. That is not a runner still starting: the agent says so under a reason of its own.
func TestARunnerOnALostNodeSaysSoOnTheAgent(t *testing.T) {
	agent := vmAgentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	_, srv := newFakeNode(t)
	dep := readyRunnerDeployment()
	dep.Status.ReadyReplicas = 0
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      dep.Name + "-abc",
			Namespace: "test-agents",
			Labels:    vmRunnerSelector(testOwner),
		},
		Spec: corev1.PodSpec{NodeName: "node-a"},
		Status: corev1.PodStatus{Phase: corev1.PodRunning, Conditions: []corev1.PodCondition{{
			Type: corev1.PodReady, Status: corev1.ConditionFalse},
		}},
	}
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-a"},
		Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{
			Type: corev1.NodeReady, Status: corev1.ConditionUnknown,
			LastTransitionTime: metav1.NewTime(time.Now().Add(-time.Hour))}}},
	}
	r, _ := setupReconciler(t, agent, leafSecret(), dep, runnerSecret(), runnerTLSSecret(), pod, node)
	r.config.VM = config.VMConfig{Runner: config.VMRunnerSpec{
		Image: "quay.io/dam-agents/vm-runner:1", Storage: "100Gi", ReserveMiB: 512, HeadroomMiB: 256, MachineCPUs: 4,
		ServiceAccountName: "platform-vm-runner", ImageCacheBudget: "50Gi", ImageCacheHostPath: "/var/lib/platform-images",
		ReleaseHostPath: "/var/lib/platform-runner-releases",
	}}
	r.runnerEndpoint = func(string) string { return srv.URL }

	require.NoError(t, r.Reconcile(context.Background(), agent))

	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	msg, reason := "", ""
	for _, c := range conds {
		if m, ok := c.(map[string]interface{}); ok && m["type"] == apiv1.ConditionAgentPodReady {
			msg, _ = m["message"].(string)
			reason, _ = m["reason"].(string)
		}
	}
	assert.Equal(t, apiv1.ReasonMachineRunnerNodeLost, reason, "a runner on a node the cluster has lost is not one still starting")
	assert.NotContains(t, msg, "node-a", "the owner reads the message, and a node name is the operator's to act on")
}

// TEST_SCENARIO: a node's Ready goes off for a kubelet stall, a network blip or a runtime restart, and the pod stays on it; the node comes back with the pod inside the kubelet's eviction toleration. That heals, so it is not a loss: the agent keeps reading "still starting", its wakes wait out the budget instead of failing at once, and no Warning Event is written. A node not ready past the grace has begun evicting its pods, and a pod the cluster has begun deleting on a node it cannot reach is the eviction that never finishes, so both read as lost — while a pod terminating on a node that reports ready is a pod on its way out normally.
func TestANodeThatOnlyBlipsIsNotLost(t *testing.T) {
	for name, tc := range map[string]struct {
		status      corev1.ConditionStatus
		since       time.Duration
		terminating bool
		want        string
	}{
		"not ready for a minute":         {status: corev1.ConditionFalse, since: time.Minute, want: vmrunner.ReasonNotReady},
		"unknown for a minute":           {status: corev1.ConditionUnknown, since: time.Minute, want: vmrunner.ReasonNotReady},
		"not ready past the grace":       {status: corev1.ConditionFalse, since: runnerNodeLostGrace + time.Minute, want: apiv1.ReasonMachineRunnerNodeLost},
		"ready again":                    {status: corev1.ConditionTrue, since: time.Minute, want: vmrunner.ReasonNotReady},
		"terminating on a ready node":    {status: corev1.ConditionTrue, since: time.Minute, terminating: true, want: vmrunner.ReasonNotReady},
		"terminating on a blipping node": {status: corev1.ConditionFalse, since: time.Minute, terminating: true, want: apiv1.ReasonMachineRunnerNodeLost},
		"terminating on a lost node":     {status: corev1.ConditionFalse, since: time.Hour, terminating: true, want: apiv1.ReasonMachineRunnerNodeLost},
	} {
		t.Run(name, func(t *testing.T) {
			pod := &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: "runner-abc", Namespace: "test-agents", Labels: vmRunnerSelector(testOwner)},
				Spec:       corev1.PodSpec{NodeName: "node-a"},
				Status:     corev1.PodStatus{Phase: corev1.PodRunning},
			}
			if tc.terminating {
				pod.DeletionTimestamp = &metav1.Time{Time: time.Now()}
				pod.Finalizers = []string{"test"}
			}
			node := &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{Name: "node-a"},
				Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{
					Type: corev1.NodeReady, Status: tc.status,
					LastTransitionTime: metav1.NewTime(time.Now().Add(-tc.since))}}},
			}
			r, _ := setupReconciler(t, vmAgentCR(), pod, node)

			reason, _ := r.runnerNotReady(context.Background(), testOwner)
			assert.Equal(t, tc.want, reason)
		})
	}
}

// TEST_SCENARIO: a lost node leaves a finished pod behind as well as a terminating one. A pod that has finished is not the owner's runner, so it must not speak over the replacement: the claim the replacement cannot attach, or the schedule it cannot get, is what the agent shows. A pod still terminating on that node does speak, because it is what keeps the claim.
func TestAFinishedRunnerPodDoesNotSpeakForItsOwner(t *testing.T) {
	unschedulable := corev1.PodCondition{Type: corev1.PodScheduled, Status: corev1.ConditionFalse,
		Message: "0/15 nodes are available: 3 node(s) had volume node affinity conflict"}
	for name, tc := range map[string]struct {
		phase corev1.PodPhase
		want  string
	}{
		"evicted on the lost node":     {phase: corev1.PodFailed, want: apiv1.ReasonMachineRunnerUnschedulable},
		"terminating on the lost node": {phase: corev1.PodRunning, want: apiv1.ReasonMachineRunnerNodeLost},
		"succeeded on the lost node":   {phase: corev1.PodSucceeded, want: apiv1.ReasonMachineRunnerUnschedulable},
	} {
		t.Run(name, func(t *testing.T) {
			agent := vmAgentCR()
			agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
			_, srv := newFakeNode(t)
			dep := readyRunnerDeployment()
			dep.Status.ReadyReplicas = 0
			old := &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: dep.Name + "-old", Namespace: "test-agents", Labels: vmRunnerSelector(testOwner)},
				Spec:       corev1.PodSpec{NodeName: "node-a"},
				Status:     corev1.PodStatus{Phase: tc.phase},
			}
			if tc.phase == corev1.PodRunning {
				old.DeletionTimestamp = &metav1.Time{Time: time.Now()}
				old.Finalizers = []string{"test"}
			}
			replacement := &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: dep.Name + "-new", Namespace: "test-agents", Labels: vmRunnerSelector(testOwner)},
				Status:     corev1.PodStatus{Phase: corev1.PodPending, Conditions: []corev1.PodCondition{unschedulable}},
			}
			node := &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{Name: "node-a"},
				Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{
					Type: corev1.NodeReady, Status: corev1.ConditionFalse,
					LastTransitionTime: metav1.NewTime(time.Now().Add(-time.Hour))}}},
			}
			r, _ := setupReconciler(t, agent, leafSecret(), dep, runnerSecret(), runnerTLSSecret(), old, replacement, node)
			r.config.VM = config.VMConfig{Runner: config.VMRunnerSpec{
				Image: "quay.io/dam-agents/vm-runner:1", Storage: "100Gi", ReserveMiB: 512, HeadroomMiB: 256, MachineCPUs: 4,
				ServiceAccountName: "platform-vm-runner", ImageCacheBudget: "50Gi", ImageCacheHostPath: "/var/lib/platform-images",
				ReleaseHostPath: "/var/lib/platform-runner-releases",
			}}
			r.runnerEndpoint = func(string) string { return srv.URL }

			require.NoError(t, r.Reconcile(context.Background(), agent))

			reason := podReadyReason(t, r)
			assert.Equal(t, tc.want, reason)
		})
	}
}

// TEST_SCENARIO: a new owner's runner pod is created together with its state claim, so the scheduler first reports the claim unbound while the volume is still provisioned. That is a runner still starting, not a failed start the user's first agent shows as an error.
func TestARunnerWaitingForItsNewVolumeIsStillStarting(t *testing.T) {
	agent := vmAgentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	_, srv := newFakeNode(t)
	dep := readyRunnerDeployment()
	dep.Status.ReadyReplicas = 0
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              dep.Name + "-abc",
			Namespace:         "test-agents",
			Labels:            map[string]string{"app.kubernetes.io/component": vmRunnerComponent, envoyOwnerLabel: testOwner},
			CreationTimestamp: metav1.Now(),
		},
		Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{
			Type: corev1.PodScheduled, Status: corev1.ConditionFalse,
			Message: "0/17 nodes are available: pod has unbound immediate PersistentVolumeClaims. not found",
		}}},
	}
	r, _ := setupReconciler(t, agent, leafSecret(), dep, runnerSecret(), runnerTLSSecret(), pod)
	r.config.VM = config.VMConfig{Runner: config.VMRunnerSpec{
		Image: "quay.io/dam-agents/vm-runner:1", Storage: "100Gi", ReserveMiB: 512, HeadroomMiB: 256, MachineCPUs: 4,
		ServiceAccountName: "platform-vm-runner", ImageCacheBudget: "50Gi", ImageCacheHostPath: "/var/lib/platform-images",
		ReleaseHostPath: "/var/lib/platform-runner-releases",
	}}
	r.runnerEndpoint = func(string) string { return srv.URL }

	require.NoError(t, r.Reconcile(context.Background(), agent))

	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	for _, c := range conds {
		if m, ok := c.(map[string]interface{}); ok && m["type"] == apiv1.ConditionAgentPodReady {
			assert.NotEqual(t, apiv1.ReasonMachineRunnerUnschedulable, m["reason"])
			assert.Contains(t, m["message"], "still starting")
		}
	}
}

// TEST_SCENARIO: a runner hosts untrusted guests, so its container holds only the capabilities it adds and none of the runtime's defaults, cannot raise them through exec, and runs under the runtime's default seccomp profile. AppArmor stays unconfined, because the runtime's default profile keeps every guest from booting. DAC_OVERRIDE is the whole list: an OOM score below the one the kubelet gives the pod takes CAP_SYS_RESOURCE in the kernel's initial user namespace, and the runner pod's own namespace is never that one, so a request for it reaches no score and costs every cluster an allowance.
func TestTheRunnerContainerIsConfinedToWhatItAdds(t *testing.T) {
	sc := runnerSecurityContext()
	require.NotNil(t, sc.Capabilities)
	assert.Equal(t, []corev1.Capability{"ALL"}, sc.Capabilities.Drop)
	assert.Equal(t, []corev1.Capability{"DAC_OVERRIDE"}, sc.Capabilities.Add)
	require.NotNil(t, sc.AllowPrivilegeEscalation)
	assert.False(t, *sc.AllowPrivilegeEscalation)
	require.NotNil(t, sc.SeccompProfile)
	assert.Equal(t, corev1.SeccompProfileTypeRuntimeDefault, sc.SeccompProfile.Type)
	require.NotNil(t, sc.AppArmorProfile)
	assert.Equal(t, corev1.AppArmorProfileTypeUnconfined, sc.AppArmorProfile.Type)
	require.NotNil(t, sc.RunAsUser)
	assert.Equal(t, int64(0), *sc.RunAsUser)
}

// TEST_SCENARIO: the runner's token is the machine API's credential, so it is 256 bits from the operating system's generator, and two runners never share one.
func TestARunnerTokenCarriesTwoHundredFiftySixBits(t *testing.T) {
	a, b := newRunnerToken(), newRunnerToken()
	assert.Len(t, a, 64)
	assert.NotEqual(t, a, b)
	_, err := hex.DecodeString(a)
	assert.NoError(t, err)
}

// TEST_SCENARIO: service links would put one set of env vars per sibling agent Service into the runner, and the runner reads none of them.
func TestTheRunnerTakesNoServiceLinks(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(context.Background(), agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(
		context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	require.NotNil(t, dep.Spec.Template.Spec.EnableServiceLinks)
	assert.False(t, *dep.Spec.Template.Spec.EnableServiceLinks,
		"service links would inject one env var set per sibling agent Service; the runner reads none of them")
}

// TEST_SCENARIO: smolvm checks a VMM against the syscalls a running microVM needs only when its embedder asks, and the runner is the embedder. It asks for enforce, so a VMM that makes a call outside the allowlist is killed.
func TestTheRunnerEnforcesItsVMMsSyscalls(t *testing.T) {
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
	assert.Equal(t, "enforce", env["SMOLVM_SECCOMP"], "unset checks nothing, and audit lets a call outside the allowlist through")
}

// TEST_SCENARIO: an install switches its VMMs' syscall filter to audit, or back, through its values, without a release.
func TestTheRunnerChecksItsVMMsSyscallsInTheInstallsMode(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Seccomp = "audit"
	require.NoError(t, r.Reconcile(context.Background(), agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(
		context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	env := map[string]string{}
	for _, e := range dep.Spec.Template.Spec.Containers[0].Env {
		env[e.Name] = e.Value
	}
	assert.Equal(t, "audit", env["SMOLVM_SECCOMP"])
}

// TEST_SCENARIO: smolvm confines a VMM's filesystem only when its embedder asks, and the runner is the embedder. Unconfined, a guest writes through its root virtiofs export into the agent rootfs every sibling machine boots from.
func TestTheRunnerConfinesItsVMMsFilesystem(t *testing.T) {
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
	assert.Equal(t, "enforce", env["SMOLVM_LANDLOCK"], "unset leaves every VMM free to write the shared agent rootfs")
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

// TEST_SCENARIO: the node's image cache service unpacks every image, so no runner holds the CHOWN, FOWNER and FSETID an unpack takes. DAC_OVERRIDE is the one capability every runner holds, for its VMMs, which read the image tree with the runner's own credentials to serve it to the guest, including files the image keeps from root.
func TestNoRunnerCanChownTheImagesItReads(t *testing.T) {
	capsFor := func(configure func(*config.VMRunnerSpec)) []corev1.Capability {
		r, _, _ := setupVMReconciler(t, vmAgentCR())
		configure(&r.config.VM.Runner)
		require.NoError(t, r.applyRunnerDeployment(context.Background(), testOwner, r.runnerOwnerRef(context.Background()), true))
		dep, err := r.client.AppsV1().Deployments("test-agents").Get(
			context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
		require.NoError(t, err)
		caps := dep.Spec.Template.Spec.Containers[0].SecurityContext.Capabilities
		require.NotNil(t, caps)
		return caps.Add
	}

	assert.ElementsMatch(t, []corev1.Capability{"DAC_OVERRIDE"}, capsFor(func(*config.VMRunnerSpec) {}))
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
