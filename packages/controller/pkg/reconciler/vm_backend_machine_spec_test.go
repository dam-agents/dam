// TEST_OVERVIEW: the machine spec the controller sends the runner carries everything the guest needs as a platform agent: the template image, the harness config, the pull Secrets in pod order, the egress allowlist, the persisted mounts, the trusted CAs and the disk size.
package reconciler

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

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

func TestAVMAgentWithNoPullSecretFetchesAnonymously(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Empty(t, node.spec("my-agent").PullAuths)
}

func TestVMBackendRunsAMachineOnTheSandboxNode(t *testing.T) {
	agent := vmAgentCR()
	r, node, requeued := setupVMReconciler(t, agent)
	ctx := context.Background()
	require.NoError(t, r.Reconcile(ctx, agent))

	spec := node.spec("my-agent")
	assert.True(t, spec.Running)
	assert.Equal(t, "quay.io/example/claude-code-vm:1", spec.Image)
	assert.Equal(t, 4, spec.CPUs)
	assert.Equal(t, 3072, spec.MemoryMiB)
	assert.Equal(t, 100, spec.StorageGiB, "a new machine is created at the owner's pool")
	assert.Equal(t, "MITM-CA", spec.CACert)
	assert.Equal(t, []string{"10.96.42.42/32"}, spec.AllowCIDRs)
	assert.Equal(t, "10.96.42.42", spec.GuestResolver, "guest DNS is relayed to the paired gateway's resolver")
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
	ready := len(requeued.all())
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, metav1.ConditionTrue, readyCondition(t, r, "my-agent").Status)
	assert.True(t, r.watchingMachine("my-agent"), "a ready machine is watched: nothing else notices its guest going quiet")
	assert.Len(t, requeued.all(), ready, "and its reconcile schedules no poll: the watch is what puts the Agent back")
	waits := node.waitingReads()
	require.Eventually(t, func() bool { return node.waitingReads() > waits+2 }, 5*time.Second, time.Millisecond,
		"the watch keeps reading the machine")
	assert.Len(t, requeued.all(), ready, "a status that did not move requeues nothing, however often it is read")
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: false})
	require.Eventually(t, func() bool { return slices.Contains(requeued.all(), time.Duration(0)) }, 5*time.Second, time.Millisecond,
		"a settled agent is reconciled only when its machine's status moves")
}

func TestAVMAgentsHarnessReachesTheGuest(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.Harness = "codex"
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.Equal(t, "codex", node.spec("my-agent").Env["PLATFORM_HARNESS"])

	agent.Spec.SecretRef = "mine"
	_, err := r.client.CoreV1().Secrets("test-agents").Create(context.Background(), &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "mine", Namespace: "test-agents", Labels: map[string]string{envoyOwnerLabel: testOwner}},
		Data:       map[string][]byte{"PLATFORM_HARNESS": []byte("pi")},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.Equal(t, "pi", node.spec("my-agent").Env["PLATFORM_HARNESS"])

	bare := vmAgentCR()
	r, node, _ = setupVMReconciler(t, bare)
	require.NoError(t, r.Reconcile(context.Background(), bare))
	assert.NotContains(t, node.spec("my-agent").Env, "PLATFORM_HARNESS")
}

func TestAVMAgentIsToldWhetherItRequiresNamedConnections(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.SecretRef = "mine"
	r, node, _ := setupVMReconciler(t, agent)
	_, err := r.client.CoreV1().Secrets("test-agents").Create(context.Background(), &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "mine", Namespace: "test-agents", Labels: map[string]string{envoyOwnerLabel: testOwner}},
		Data:       map[string][]byte{"PLATFORM_REQUIRE_CONNECTION_ADDRESS": []byte("true")},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.Equal(t, "false", node.spec("my-agent").Env["PLATFORM_REQUIRE_CONNECTION_ADDRESS"])

	addressed := vmAgentCR()
	addressed.Spec.RequireConnectionAddress = true
	r, node, _ = setupVMReconciler(t, addressed)
	require.NoError(t, r.Reconcile(context.Background(), addressed))
	assert.Equal(t, "true", node.spec("my-agent").Env["PLATFORM_REQUIRE_CONNECTION_ADDRESS"])
}

func TestAHostRunnerReachesTheGatewayOnItsOwnLoopback(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.HostAddress = "192.168.5.2"
	ctx := context.Background()
	for _, sec := range []*corev1.Secret{runnerSecret(), runnerTLSSecret()} {
		sec.Name = strings.Replace(sec.Name, runnerSuffix(testOwner), "host", 1)
		_, err := r.client.CoreV1().Secrets("test-agents").Create(ctx, sec, metav1.CreateOptions{})
		require.NoError(t, err)
	}
	r.client.(*fake.Clientset).PrependReactor("update", "services", func(action k8stesting.Action) (bool, runtime.Object, error) {
		svc := action.(k8stesting.UpdateAction).GetObject().(*corev1.Service)
		if svc.Spec.Type == corev1.ServiceTypeNodePort && svc.Spec.Ports[0].NodePort == 0 {
			svc.Spec.Ports[0].NodePort = 30123
		}
		return false, svc, nil
	})

	require.NoError(t, r.Reconcile(ctx, agent))

	spec := node.spec("my-agent")
	assert.Empty(t, spec.AllowCIDRs)
	assert.Equal(t, 30123, spec.GatewayHostPort)
	assert.Empty(t, spec.GuestResolver, "a runner outside the cluster cannot reach the gateway's resolver, so guest DNS stays relayed nowhere")
	assert.Equal(t, "http://100.96.0.1:30123", spec.Env["HTTPS_PROXY"])
	svc, err := r.client.CoreV1().Services("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Nil(t, svc.Spec.Selector, "no runner pod to select")
	slice, err := r.client.DiscoveryV1().EndpointSlices("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-agent", slice.Labels[discoveryv1.LabelServiceName])
	assert.Equal(t, []string{"192.168.5.2"}, slice.Endpoints[0].Addresses)
	assert.Equal(t, int32(31000), *slice.Ports[0].Port)
	assert.Equal(t, intstr.FromInt(31000), svc.Spec.Ports[0].TargetPort)

	r.Delete(ctx, "my-agent", AgentOwner(agent.Labels), deleteAgentCR(t, r, "my-agent"))
	assert.Equal(t, []string{"my-agent"}, node.deleted)
}

func TestTheHostRunnerGetsOneUsageSecretNamingNoOwner(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.HostAddress = "192.168.5.2"
	ctx := context.Background()
	for _, sec := range []*corev1.Secret{runnerSecret(), runnerTLSSecret()} {
		sec.Name = strings.Replace(sec.Name, runnerSuffix(testOwner), "host", 1)
		_, err := r.client.CoreV1().Secrets("test-agents").Create(ctx, sec, metav1.CreateOptions{})
		require.NoError(t, err)
	}
	r.client.(*fake.Clientset).PrependReactor("update", "services", func(action k8stesting.Action) (bool, runtime.Object, error) {
		svc := action.(k8stesting.UpdateAction).GetObject().(*corev1.Service)
		if svc.Spec.Type == corev1.ServiceTypeNodePort && svc.Spec.Ports[0].NodePort == 0 {
			svc.Spec.Ports[0].NodePort = 30123
		}
		return false, svc, nil
	})

	require.NoError(t, r.Reconcile(ctx, agent))

	secrets := r.client.CoreV1().Secrets("test-agents")
	usage, err := secrets.Get(ctx, r.runnerUsageName(""), metav1.GetOptions{})
	require.NoError(t, err)
	token, err := secrets.Get(ctx, r.runnerName(""), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "true", usage.Labels[vmRunnerUsageLabel])
	_, owned := usage.Labels[envoyOwnerLabel]
	assert.False(t, owned, "one Secret serves every owner, so it names none")
	assert.Equal(t, fmt.Sprintf("https://192.168.5.2:%d", vmRunnerPort), string(usage.Data["url"]))
	assert.Equal(t, vmrunner.MintUsageCapability(string(token.Data["token"])), string(usage.Data["capability"]))
}

func TestVMBackendRefusesADiskSizeItCannotParse(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.StorageSize = "5GG"
	r, node, _ := setupVMReconciler(t, agent)

	err := r.Reconcile(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "5GG")
	assert.Empty(t, node.specs, "no machine is created from a spec the controller could not size")
}

func TestVMBackendSizesOneDiskRatherThanSummingMounts(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.Mounts = []apiv1.Mount{
		{Path: "/home/agent", Persist: true, Size: "4Gi"},
		{Path: "/home/agent/work", Persist: true, Size: "4Gi"},
	}
	r, node, _ := setupVMReconciler(t, agent)
	node.holdsOnAnOlderRelease("my-agent")
	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Equal(t, 10, node.spec("my-agent").StorageGiB, "the Agent's storage size, not 4+4")
}

func TestANewMachineIsCreatedAtTheOwnersPool(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.Equal(t, 100, node.spec("my-agent").StorageGiB, "the owner's pool, runner.storage")
}

func TestAnExistingMachineTakesThePoolOnceTheRunnerReportsDisks(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.holdsOnAnOlderRelease("my-agent")
	ctx := context.Background()
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, 10, node.spec("my-agent").StorageGiB, "no disk reported: the Agent's own size")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000, DiskGiB: 10})
	require.NoError(t, r.Reconcile(ctx, agent))
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, 100, node.spec("my-agent").StorageGiB, "the owner's pool, runner.storage")
}

func TestTheUsageSecretHoldsACapabilityAndNeverTheToken(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	ctx := context.Background()
	require.NoError(t, r.Reconcile(ctx, agent))

	secrets := r.client.CoreV1().Secrets(r.config.Namespace)
	usage, err := secrets.Get(ctx, r.runnerUsageName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	token, err := secrets.Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "true", usage.Labels[vmRunnerUsageLabel])
	assert.Equal(t, testOwner, usage.Labels[envoyOwnerLabel])
	assert.Equal(t, vmrunner.MintUsageCapability(string(token.Data["token"])), string(usage.Data["capability"]))
	assert.Equal(t, fmt.Sprintf("https://%s:%d", r.runnerHost(testOwner), vmRunnerPort), string(usage.Data["url"]))
	assert.ElementsMatch(t, []string{"url", "ca.crt", "capability"}, slices.Collect(maps.Keys(usage.Data)))
	for _, v := range usage.Data {
		assert.NotContains(t, string(v), string(token.Data["token"]))
	}
}

func TestVMBackendAcceptsTheDefaultMounts(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.Mounts = []apiv1.Mount{
		{Path: "/home/agent", Persist: true},
		{Path: "/tmp", Persist: false},
	}
	r, node, _ := setupVMReconciler(t, agent)
	node.holdsOnAnOlderRelease("my-agent")
	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Equal(t, 10, node.spec("my-agent").StorageGiB)
}

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

func TestTheMachineDiskIsNoSmallerThanAnyMountAsksFor(t *testing.T) {
	disk := func(configure func(*apiv1.AgentSpec)) int {
		agent := vmAgentCR()
		configure(&agent.Spec)
		r, node, _ := setupVMReconciler(t, agent)
		node.holdsOnAnOlderRelease("my-agent")
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

func TestMachineTrustedCAsAppendsTheExtraCAs(t *testing.T) {
	assert.Equal(t, "MITM-CA", machineTrustedCAs("MITM-CA", testConfig))

	cfg := *testConfig
	cfg.ExtraTrustedCAs = "-----BEGIN CERTIFICATE-----\nextra\n-----END CERTIFICATE-----\n"
	assert.Equal(t, "-----BEGIN CERTIFICATE-----\nmitm\n-----END CERTIFICATE-----\n"+cfg.ExtraTrustedCAs,
		machineTrustedCAs("-----BEGIN CERTIFICATE-----\nmitm\n-----END CERTIFICATE-----", &cfg))
}
