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

func TestTheRunnerResolvesThroughTheNodeNotTheCluster(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, corev1.DNSDefault, dep.Spec.Template.Spec.DNSPolicy)
}

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

func TestTheRunnerPodRunsInAUserNamespace(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	require.NotNil(t, dep.Spec.Template.Spec.HostUsers)
	assert.False(t, *dep.Spec.Template.Spec.HostUsers)
}

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
	r.config.VM = config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{
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
			r.config.VM = config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{
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
	r.config.VM = config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{
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

func TestTheRunnerContainerIsConfinedToWhatItAdds(t *testing.T) {
	sc := runnerSecurityContext()
	require.NotNil(t, sc.Capabilities)
	assert.Equal(t, []corev1.Capability{"ALL"}, sc.Capabilities.Drop)
	assert.Equal(t, []corev1.Capability{"DAC_OVERRIDE", "SYS_RESOURCE"}, sc.Capabilities.Add)
	require.NotNil(t, sc.AllowPrivilegeEscalation)
	assert.False(t, *sc.AllowPrivilegeEscalation)
	require.NotNil(t, sc.SeccompProfile)
	assert.Equal(t, corev1.SeccompProfileTypeRuntimeDefault, sc.SeccompProfile.Type)
	require.NotNil(t, sc.AppArmorProfile)
	assert.Equal(t, corev1.AppArmorProfileTypeUnconfined, sc.AppArmorProfile.Type)
	require.NotNil(t, sc.RunAsUser)
	assert.Equal(t, int64(0), *sc.RunAsUser)
}

func TestARunnerTokenCarriesTwoHundredFiftySixBits(t *testing.T) {
	a, b := newRunnerToken(), newRunnerToken()
	assert.Len(t, a, 64)
	assert.NotEqual(t, a, b)
	_, err := hex.DecodeString(a)
	assert.NoError(t, err)
}

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

	assert.ElementsMatch(t, []corev1.Capability{"DAC_OVERRIDE", "SYS_RESOURCE"}, capsFor(func(*config.VMRunnerSpec) {}))
}

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
