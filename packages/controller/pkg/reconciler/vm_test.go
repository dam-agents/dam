package reconciler

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
)

func vmAgentCR() *apiv1.Agent {
	a := agentCR()
	a.Spec.Backend = &apiv1.Backend{Type: "vm"}
	a.Spec.Resources.Limits = map[string]string{"cpu": "2500m", "memory": "6Gi"}
	a.Spec.Mounts = []apiv1.Mount{
		{Path: "/home/agent", Persist: true, Size: "10Gi"},
		{Path: "/scratchpad", Persist: false},
	}
	return a
}

func setupVMReconciler(t *testing.T, agent *apiv1.Agent) *AgentReconciler {
	t.Helper()
	leaf := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: EnvoyLeafSecretName(agent.Name), Namespace: "test-agents"},
		Data:       map[string][]byte{"ca.crt": []byte("PEMDATA")},
	}
	r, _ := setupReconciler(t, agent, leaf)
	// Probes on (the chart default): the readinessProbe map must survive
	// applyVirtualMachine's unstructured deep copy on the update path.
	r.config.AgentProbesEnabled = true
	r.config.KubeAPIAddr = "10.43.0.1:443"
	r.config.VM = config.VMConfig{
		Enabled:      true,
		ScratchSize:  "30Gi",
		NodeSelector: map[string]string{"kvm": "true"},
	}
	return r
}

func getVM(t *testing.T, r *AgentReconciler, name string) *unstructured.Unstructured {
	t.Helper()
	vm, err := r.dynamic.Resource(VirtualMachinesGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	return vm
}

func TestVMBackendReconcilesVirtualMachine(t *testing.T) {
	agent := vmAgentCR()
	r := setupVMReconciler(t, agent)
	ctx := context.Background()
	require.NoError(t, r.Reconcile(ctx, agent))

	vm := getVM(t, r, "my-agent")

	// Activity-less agent fails open to running → runStrategy Always.
	strategy, _, _ := unstructured.NestedString(vm.Object, "spec", "runStrategy")
	assert.Equal(t, vmRunStrategyAlways, strategy)

	// virt-launcher pod labels: pair selectors + ambient opt-out, so the
	// egress NetworkPolicy and agent Service bind to the launcher pod.
	podLabels, _, _ := unstructured.NestedStringMap(vm.Object, "spec", "template", "metadata", "labels")
	assert.Equal(t, "my-agent", podLabels[LabelPair])
	assert.Equal(t, RoleAgent, podLabels[LabelRole])
	assert.Equal(t, "none", podLabels["istio.io/dataplane-mode"])

	// Guest sizing: cpu ceil(2500m)=3 cores, memory 1:1.
	cores, _, _ := unstructured.NestedInt64(vm.Object, "spec", "template", "spec", "domain", "cpu", "cores")
	assert.Equal(t, int64(3), cores)
	mem, _, _ := unstructured.NestedString(vm.Object, "spec", "template", "spec", "domain", "memory", "guest")
	assert.Equal(t, "6Gi", mem)

	// Volumes: boot containerDisk from spec.image, cloudinit secret, scratch
	// emptyDisk, one PVC per persisted mount (ephemeral mounts don't render).
	volumes, _, _ := unstructured.NestedSlice(vm.Object, "spec", "template", "spec", "volumes")
	names := map[string]map[string]any{}
	for _, v := range volumes {
		m := v.(map[string]any)
		names[m["name"].(string)] = m
	}
	assert.Contains(t, names, "boot")
	assert.Contains(t, names, "cloudinit")
	assert.Contains(t, names, "scratch")
	assert.Contains(t, names, "home-agent")
	assert.NotContains(t, names, "scratchpad")
	boot := names["boot"]["containerDisk"].(map[string]any)
	assert.Equal(t, agent.Spec.Image, boot["image"])
	assert.Equal(t, "IfNotPresent", boot["imagePullPolicy"])

	// containerDisk validates imagePullPolicy as a strict enum — an unset
	// policy must be omitted, not rendered as "" (KubeVirt admission rejects
	// the VM outright).
	bare := vmAgentCR()
	bare.Spec.ImagePullPolicy = ""
	r.config.AgentTemplateDefaults.ImagePullPolicy = ""
	bareVM, err := BuildAgentVirtualMachine("my-agent", &bare.Spec, r.config, agentOwnerRef(bare), "10.96.42.42")
	require.NoError(t, err)
	bareVolumes, _, _ := unstructured.NestedSlice(bareVM.Object, "spec", "template", "spec", "volumes")
	for _, v := range bareVolumes {
		if m := v.(map[string]any); m["name"] == "boot" {
			assert.NotContains(t, m["containerDisk"].(map[string]any), "imagePullPolicy")
		}
	}

	// virtiofs filesystem for the persisted mount; PVC created with the
	// StatefulSet-convention name and agent labels.
	filesystems, _, _ := unstructured.NestedSlice(vm.Object, "spec", "template", "spec", "domain", "devices", "filesystems")
	require.Len(t, filesystems, 1)
	assert.Equal(t, "home-agent", filesystems[0].(map[string]any)["name"])
	pvc, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-agent", pvc.Labels[LabelAgent])

	// VM nodeSelector from chart config.
	sel, _, _ := unstructured.NestedStringMap(vm.Object, "spec", "template", "spec", "nodeSelector")
	assert.Equal(t, "true", sel["kvm"])

	// No agent StatefulSet on the vm backend; the gateway pair still renders.
	_, err = r.client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err))
	_, err = r.client.AppsV1().StatefulSets("test-agents").Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	assert.NoError(t, err)

	// Readiness probe present with JSON-safe (int64) numerics.
	probePort, found, _ := unstructured.NestedInt64(vm.Object, "spec", "template", "spec", "readinessProbe", "httpGet", "port")
	require.True(t, found, "readinessProbe must render when probes are enabled")
	assert.Equal(t, int64(8080), probePort)

	// Cloud-init: env file with proxy wiring (values shell-quoted — the file
	// is shell-sourced by the boot gate), the CA, the boot-gate deny target,
	// and virtiofs mounts for persisted mounts ONLY (an ephemeral mount has no
	// virtiofs device; mounting it every boot would fail).
	ci, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, VMCloudInitSecretName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	userdata := ci.StringData["userdata"]
	assert.True(t, strings.HasPrefix(userdata, "#cloud-config\n"))
	assert.Contains(t, userdata, "HTTPS_PROXY='http://10.96.42.42:10000'")
	assert.Contains(t, userdata, "PLATFORM_AGENT_ID='my-agent'")
	assert.Contains(t, userdata, "PLATFORM_KUBE_API_DENY='10.43.0.1:443'")
	assert.Contains(t, userdata, "PEMDATA")
	// The share must be mounted from bootcmd, never cloud-init's `mounts:`
	// module: that runs every device through sanitize_devname(), which returns
	// None for a bare virtiofs tag, so the entry is silently dropped and the
	// workspace never mounts. Assert the mechanism, not just the tag — the
	// broken form also contained "home-agent".
	// Substrings kept short: go-yaml folds the long command across lines (it
	// re-parses to the same string, but a full-command match would be brittle).
	assert.Contains(t, userdata, "bootcmd:")
	assert.Contains(t, userdata, "mount -t virtiofs 'home-agent'")
	assert.Contains(t, userdata, "mountpoint -q '/home/agent'")
	assert.NotContains(t, userdata, "mounts:", "cloud-init's mounts module drops bare virtiofs tags")
	// An ephemeral mount still needs its directory: agent-runtime spawns the
	// harness with WORK_DIR as cwd, and a missing cwd fails the spawn.
	assert.Contains(t, userdata, "mkdir -p '/scratchpad'")
	assert.NotContains(
		t,
		userdata,
		"mount -t virtiofs 'scratchpad'",
		"ephemeral mounts have no virtiofs device to mount",
	)
	// The ~/.cache swap must be pre-created by root: on unprivileged virtiofs
	// a non-root guest cannot create symlinks (virtiofsd lacks CAP_CHOWN), so
	// the entrypoint's own `ln` would fail with EPERM.
	assert.Contains(t, userdata, "ln -sfn /tmp/agent-cache")
}

func TestVMSpecSurvivesUnstructuredDeepCopy(t *testing.T) {
	// applyVirtualMachine's update path deep-copies the rendered template as
	// unstructured JSON, which panics on non-JSON scalar types (plain int) —
	// every rendered value must be JSON-safe.
	agent := vmAgentCR()
	r := setupVMReconciler(t, agent)
	vm, err := BuildAgentVirtualMachine("my-agent", &agent.Spec, r.config, agentOwnerRef(agent), "10.96.42.42")
	require.NoError(t, err)
	assert.NotPanics(t, func() { vm.DeepCopy() })
}

func TestVMBackendDisabledFailsReconcile(t *testing.T) {
	agent := vmAgentCR()
	r := setupVMReconciler(t, agent)
	r.config.VM.Enabled = false
	err := r.Reconcile(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "virtualization is disabled")
}

func TestVMHibernationHaltsVM(t *testing.T) {
	agent := vmAgentCR()
	r := setupVMReconciler(t, agent)
	ctx := context.Background()
	require.NoError(t, r.Reconcile(ctx, agent))

	// Stale activity → idle candidate; probe overridden to not-busy.
	stale := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	require.NoError(t, unstructured.SetNestedMap(u.Object, map[string]any{annLastActivity: stale}, "metadata", "annotations"))
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, u, metav1.UpdateOptions{})
	require.NoError(t, err)

	checker := NewIdleChecker(r.client, r.dynamic, r.config)
	checker.busyProbe = func(context.Context, string) bool { return false }
	checker.check(ctx)

	vm := getVM(t, r, "my-agent")
	strategy, _, _ := unstructured.NestedString(vm.Object, "spec", "runStrategy")
	assert.Equal(t, vmRunStrategyHalted, strategy)
}

func TestVMWakePreservesTemplateAndFlipsStrategy(t *testing.T) {
	agent := vmAgentCR()
	r := setupVMReconciler(t, agent)
	ctx := context.Background()
	require.NoError(t, r.Reconcile(ctx, agent))
	require.NoError(t, haltAgentVMs(ctx, r.dynamic, "test-agents", "my-agent"))

	// Re-reconcile with fresh activity: strategy flips back to Always.
	agent.Annotations = map[string]string{annLastActivity: time.Now().UTC().Format(time.RFC3339)}
	require.NoError(t, r.Reconcile(ctx, agent))
	vm := getVM(t, r, "my-agent")
	strategy, _, _ := unstructured.NestedString(vm.Object, "spec", "runStrategy")
	assert.Equal(t, vmRunStrategyAlways, strategy)
}
