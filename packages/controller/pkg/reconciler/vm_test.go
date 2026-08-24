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
	a.Spec.Init = "echo custom-init-ignored"
	return a
}

func setupVMReconciler(t *testing.T, agent *apiv1.Agent) *AgentReconciler {
	t.Helper()
	leaf := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: EnvoyLeafSecretName(agent.Name), Namespace: "test-agents"},
		Data:       map[string][]byte{"ca.crt": []byte("PEMDATA")},
	}
	r, _ := setupReconciler(t, agent, leaf)
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

	strategy, _, _ := unstructured.NestedString(vm.Object, "spec", "runStrategy")
	assert.Equal(t, vmRunStrategyAlways, strategy)

	podLabels, _, _ := unstructured.NestedStringMap(vm.Object, "spec", "template", "metadata", "labels")
	assert.Equal(t, "my-agent", podLabels[LabelPair])
	assert.Equal(t, RoleAgent, podLabels[LabelRole])
	assert.Equal(t, "none", podLabels["istio.io/dataplane-mode"])

	cores, _, _ := unstructured.NestedInt64(vm.Object, "spec", "template", "spec", "domain", "cpu", "cores")
	assert.Equal(t, int64(3), cores)
	mem, _, _ := unstructured.NestedString(vm.Object, "spec", "template", "spec", "domain", "memory", "guest")
	assert.Equal(t, "6Gi", mem)

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

	filesystems, _, _ := unstructured.NestedSlice(vm.Object, "spec", "template", "spec", "domain", "devices", "filesystems")
	require.Len(t, filesystems, 1)
	assert.Equal(t, "home-agent", filesystems[0].(map[string]any)["name"])
	pvc, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-agent", pvc.Labels[LabelAgent])

	sel, _, _ := unstructured.NestedStringMap(vm.Object, "spec", "template", "spec", "nodeSelector")
	assert.Equal(t, "true", sel["kvm"])

	_, err = r.client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	assert.True(t, errors.IsNotFound(err))
	_, err = r.client.AppsV1().StatefulSets("test-agents").Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	assert.NoError(t, err)

	probePort, found, _ := unstructured.NestedInt64(vm.Object, "spec", "template", "spec", "readinessProbe", "httpGet", "port")
	require.True(t, found, "readinessProbe must render when probes are enabled")
	assert.Equal(t, int64(8080), probePort)

	ci, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, VMCloudInitSecretName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	userdata := ci.StringData["userdata"]
	assert.True(t, strings.HasPrefix(userdata, "#cloud-config\n"))
	assert.Contains(t, userdata, "HTTPS_PROXY='http://10.96.42.42:10000'")
	assert.Contains(t, userdata, "PLATFORM_AGENT_ID='my-agent'")
	assert.Contains(t, userdata, "NO_PROXY='localhost,127.0.0.1,::1'")
	assert.NotContains(t, userdata, "NO_PROXY='localhost,127.0.0.1,::1,")
	assert.Contains(t, userdata, "JAVA_TOOL_OPTIONS='-Duser.home=/home/agent")
	assert.Contains(t, userdata, "-Dhttp.proxyHost=10.96.42.42 -Dhttp.proxyPort=")
	assert.Contains(t, userdata, "PLATFORM_KUBE_API_DENY='10.43.0.1:443'")
	assert.Contains(t, userdata, "PEMDATA")
	assert.Contains(t, userdata, "bootcmd:")
	assert.Contains(t, userdata, "mount -t virtiofs 'home-agent'")
	assert.Contains(t, userdata, "mountpoint -q '/home/agent'")
	assert.NotContains(t, userdata, "mounts:", "cloud-init's mounts module drops bare virtiofs tags")
	assert.Contains(t, userdata, "mkdir -p '/scratchpad'")
	assert.NotContains(
		t,
		userdata,
		"mount -t virtiofs 'scratchpad'",
		"ephemeral mounts have no virtiofs device to mount",
	)
	assert.NotContains(t, userdata, "custom-init-ignored", "spec.init is retained but no longer read")
	assert.Contains(t, userdata, ".initialized", "the static first-boot seed rides userdata")
	assert.Contains(t, userdata, "ln -sfn /tmp/agent-cache")
}

func TestVMSpecSurvivesUnstructuredDeepCopy(t *testing.T) {
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

	agent.Annotations = map[string]string{annLastActivity: time.Now().UTC().Format(time.RFC3339)}
	require.NoError(t, r.Reconcile(ctx, agent))
	vm := getVM(t, r, "my-agent")
	strategy, _, _ := unstructured.NestedString(vm.Object, "spec", "runStrategy")
	assert.Equal(t, vmRunStrategyAlways, strategy)
}
