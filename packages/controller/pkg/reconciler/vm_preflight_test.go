// TEST_OVERVIEW: with virtualization on, the controller reads the install against the cluster before any vm agent needs a runner. It must name each setup that stops every runner from working — no node advertising the device resources, a missing runner ServiceAccount, an image cache with no node directory or a budget it cannot read, a memory limit that leaves no machine room. A vm agent whose runner is not ready carries those problems in its status.
package reconciler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

func preflightConfig() *config.Config {
	return &config.Config{
		Namespace:        "test-agents",
		ReleaseNamespace: "platform",
		ReleaseName:      "platform",
		PodName:          "controller-0",
		KubeAPIAddr:      "172.30.0.1:443",
		VM: config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{
			Image: "vm-runner:1", Storage: "100Gi", ReserveMiB: 512,
			ServiceAccountName: "platform-vm-runner", ImageCacheBudget: "50Gi", ImageCacheHostPath: "/var/lib/platform-images",
			Devices:      map[string]string{"devices.kubevirt.io/kvm": "1", "devices.kubevirt.io/tun": "1"},
			NodeSelector: map[string]string{"pool": "virt"},
			Resources: &corev1.ResourceRequirements{Limits: corev1.ResourceList{
				corev1.ResourceMemory: resource.MustParse("8Gi"),
			}},
		}},
	}
}

func kvmNode(name string, nodeLabels map[string]string) *corev1.Node {
	return &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: name, Labels: nodeLabels},
		Status: corev1.NodeStatus{Allocatable: corev1.ResourceList{
			"devices.kubevirt.io/kvm": resource.MustParse("1k"),
			"devices.kubevirt.io/tun": resource.MustParse("1k"),
		}},
	}
}

func preflightCluster(extra ...runtime.Object) []runtime.Object {
	return append([]runtime.Object{
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner", Namespace: "test-agents"}},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "controller-0", Namespace: "platform"},
			Status:     corev1.PodStatus{PodIP: "10.128.2.7"},
		},
	}, extra...)
}

func runPreflight(cfg *config.Config, objects ...runtime.Object) vmPreflightResult {
	r := NewAgentReconciler(fake.NewSimpleClientset(objects...), newFakeDynamic(), cfg)
	return r.vmPreflight(context.Background())
}

// TEST_SCENARIO: an install that got everything right — a node in the runner's pool advertises both devices, and the runner identity exists — gets nothing to fix and nothing to worry about.
func TestPreflightPassesACorrectInstall(t *testing.T) {
	res := runPreflight(preflightConfig(), preflightCluster(kvmNode("virt-1", map[string]string{"pool": "virt"}))...)
	assert.Empty(t, res.problems)
	assert.Empty(t, res.warnings)
}

// TEST_SCENARIO: the devices are advertised, but only on a node outside the runner's node selector — or nowhere, because no plugin is installed. Either way every runner pod pends forever, so this is named as a problem with the resources and the values that fix it.
func TestPreflightNamesDevicesNoRunnerNodeAdvertises(t *testing.T) {
	res := runPreflight(preflightConfig(), preflightCluster(kvmNode("worker-1", map[string]string{"pool": "general"}))...)
	require.Len(t, res.problems, 1)
	assert.Contains(t, res.problems[0], "virtualization.runner.nodeSelector")
	assert.Contains(t, res.problems[0], "devices.kubevirt.io/kvm and devices.kubevirt.io/tun")

	cordoned := kvmNode("virt-1", map[string]string{"pool": "virt"})
	cordoned.Spec.Unschedulable = true
	res = runPreflight(preflightConfig(), preflightCluster(cordoned)...)
	assert.Len(t, res.problems, 1, "a cordoned node places no runner")
}

// TEST_SCENARIO: the runner ServiceAccount is what every runner pod runs as and what owns it; without it no runner can be created, which otherwise surfaces only as a Deployment that never gets a pod.
func TestPreflightNamesAMissingRunnerServiceAccount(t *testing.T) {
	res := runPreflight(preflightConfig(),
		kvmNode("virt-1", map[string]string{"pool": "virt"}),
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "controller-0", Namespace: "platform"}, Status: corev1.PodStatus{PodIP: "10.128.2.7"}})
	require.Len(t, res.problems, 1)
	assert.Contains(t, res.problems[0], "test-agents/platform-vm-runner does not exist")
}

// TEST_SCENARIO: values the controller cannot use — a budget that is not a quantity, a memory limit no larger than the runner's own reserve — are each named with the value to fix.
func TestPreflightNamesValuesTheControllerCannotUse(t *testing.T) {
	cfg := preflightConfig()
	cfg.VM.Runner.ImageCacheBudget = "fifty gigs"
	cfg.VM.Runner.Resources.Limits[corev1.ResourceMemory] = resource.MustParse("512Mi")
	res := runPreflight(cfg, preflightCluster(kvmNode("virt-1", map[string]string{"pool": "virt"}))...)
	require.Len(t, res.problems, 2)
	assert.Contains(t, res.problems[0], "virtualization.imageCache.budget")
	assert.Contains(t, res.problems[1], "no machine ever fits")
}

// TEST_SCENARIO: the node image cache is the only place a runner pod gets an image from, so an install that names no node directory for it leaves every runner with nothing to boot. That is a problem naming the value to set. The Mac's host runner stages its own images and needs none.
func TestPreflightNamesAnInstallWithNoNodeCache(t *testing.T) {
	cfg := preflightConfig()
	cfg.VM.Runner.ImageCacheHostPath = ""
	res := runPreflight(cfg, preflightCluster(kvmNode("virt-1", map[string]string{"pool": "virt"}))...)
	require.Len(t, res.problems, 1)
	assert.Contains(t, res.problems[0], "virtualization.imageCache.hostPath")

	cfg.VM.Runner.HostAddress = "192.168.5.2"
	res = runPreflight(cfg, preflightCluster()...)
	assert.Empty(t, res.problems, "the host runner is not a pod on the node cache")
}

// TEST_SCENARIO: a vm agent whose runner is not ready on an install that cannot run one says so in its status, next to what the runner pod reports, rather than reading "still starting" until someone reads the cluster by hand.
func TestAVMAgentCarriesThePreflightProblems(t *testing.T) {
	agent := vmAgentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	dep := readyRunnerDeployment()
	dep.Status.ReadyReplicas = 0
	_, srv := newFakeNode(t)
	r, _ := setupReconciler(t, agent, leafSecret(), dep, runnerSecret(), runnerTLSSecret())
	r.config.VM = config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{
		Image: "quay.io/dam-agents/vm-runner:1", Storage: "100Gi", ReserveMiB: 512,
		ServiceAccountName: "platform-vm-runner", ImageCacheBudget: "50Gi", ImageCacheHostPath: "/var/lib/platform-images",
		Devices: map[string]string{"devices.kubevirt.io/kvm": "1"},
	}}
	r.runnerEndpoint = func(string) string { return srv.URL }
	r.CheckVMInstall(context.Background())
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
	assert.Contains(t, msg, "still starting")
	assert.Contains(t, msg, "this install cannot run VM runners as configured")
	assert.Contains(t, msg, "no schedulable node advertises devices.kubevirt.io/kvm")
}
