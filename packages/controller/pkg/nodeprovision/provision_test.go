// TEST_OVERVIEW: the sandbox-node provisioner learns what it cannot be told by values from the cluster itself: the node addresses (which become the machines' ingress allow-list and the next hop for the Service-CIDR route) and the cluster's Service CIDR from the ServiceCIDR API, while an operator-set CIDR wins.
package nodeprovision

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
)

func servicecidr(name string, cidrs ...any) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "networking.k8s.io/v1", "kind": "ServiceCIDR",
		"metadata": map[string]any{"name": name},
		"spec":     map[string]any{"cidrs": cidrs},
	}}
}

// TEST_SCENARIO: two nodes and a dual-stack ServiceCIDR: every node address is allowed in, the first becomes the route's next hop, and the IPv4 CIDR is the one routed.
func TestDiscoverClusterReadsNodesAndServiceCIDR(t *testing.T) {
	kube := fake.NewSimpleClientset(
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "a"}, Status: corev1.NodeStatus{Addresses: []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: "10.0.0.1"}, {Type: corev1.NodeHostName, Address: "a"}}}},
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "b"}, Status: corev1.NodeStatus{Addresses: []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: "10.0.0.2"}}}},
	)
	scheme := runtime.NewScheme()
	dyn := dynfake.NewSimpleDynamicClientWithCustomListKinds(scheme,
		map[schema.GroupVersionResource]string{{Group: "networking.k8s.io", Version: "v1", Resource: "servicecidrs"}: "ServiceCIDRList"},
		servicecidr("kubernetes", "fd00::/108", "10.43.0.0/16"))

	c := Config{AllowFrom: []string{"192.168.0.0/24"}}
	require.NoError(t, c.DiscoverCluster(t.Context(), kube, dyn))
	assert.Equal(t, []string{"192.168.0.0/24", "10.0.0.1/32", "10.0.0.2/32"}, c.AllowFrom)
	assert.Equal(t, "10.0.0.1", c.RouteVia)
	assert.Equal(t, "10.43.0.0/16", c.ServiceCIDR)

	// TEST_SCENARIO: an operator who sets the Service CIDR (a cluster without the ServiceCIDR API) is not second-guessed.
	pinned := Config{ServiceCIDR: "172.20.0.0/16", RouteVia: "10.9.9.9"}
	require.NoError(t, pinned.DiscoverCluster(t.Context(), kube, dynfake.NewSimpleDynamicClient(scheme)))
	assert.Equal(t, "172.20.0.0/16", pinned.ServiceCIDR)
	assert.Equal(t, "10.9.9.9", pinned.RouteVia)
}

// TEST_SCENARIO: the Job's environment is the whole contract; a missing SSH identity or token fails before any SSH is attempted.
func TestConfigFromEnvRequiresTheEssentials(t *testing.T) {
	t.Setenv("NODE_HOST", "10.1.1.1")
	t.Setenv("NODE_SSH_USER", "ops")
	t.Setenv("NODE_TOKEN", "t")
	_, err := ConfigFromEnv()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "NODE_SSH_KEY")

	t.Setenv("NODE_SSH_KEY", "PEM")
	t.Setenv("NODE_INGRESS_CIDRS", "10.42.0.0/16,10.44.0.0/16")
	c, err := ConfigFromEnv()
	require.NoError(t, err)
	assert.Equal(t, 22, c.SSHPort)
	assert.Equal(t, "1.16.0", c.SmolvmVersion)
	assert.Equal(t, []string{"10.42.0.0/16", "10.44.0.0/16"}, c.AllowFrom)
}
