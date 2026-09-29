package reconciler

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// TEST_OVERVIEW: a vm Agent's machine reaches the network through its gateway without proxy settings. The gateway resolves every name to itself and never upstream, accepts TLS on a transparent port that feeds the same egress-checked chains a CONNECT does, and routes plain HTTP by Host on the proxy listener; the Service, the gateway's ingress policy and the runner's egress policy open exactly those ports; and container Agents get none of it.

func bootstrapListeners(t *testing.T, doc map[string]any) map[string]map[string]any {
	t.Helper()
	sr, _ := doc["static_resources"].(map[string]any)
	raw, _ := sr["listeners"].([]any)
	out := map[string]map[string]any{}
	for _, l := range raw {
		if m, ok := l.(map[string]any); ok {
			out[m["name"].(string)] = m
		}
	}
	return out
}

// TEST_SCENARIO: raw TLS on the transparent port must land in the internal listener a CONNECT is unwrapped into, where every chain — credential chains and the SNI-miss chain that holds a never-approved host — runs its egress check before dialing. A listener that dialed anything itself would be a way around approval.
func TestTransparentTLSFeedsTheEgressCheckedChainsOnlyForAMachine(t *testing.T) {
	vm, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{credentialedChain("platform-conn-github", "github.com")}, true)
	require.NoError(t, err)
	listeners := bootstrapListeners(t, mustParseBootstrap(t, vm))
	transparent, ok := listeners["transparent_tls"]
	require.True(t, ok, "a machine's gateway accepts TLS without CONNECT")

	addr := transparent["address"].(map[string]any)["socket_address"].(map[string]any)
	assert.EqualValues(t, gatewayTransparentTLSPort, addr["port_value"])
	chains := transparent["filter_chains"].([]any)
	require.Len(t, chains, 1)
	filters := chains[0].(map[string]any)["filters"].([]any)
	require.Len(t, filters, 1, "nothing may run before the internal listener's own egress checks")
	proxy := filters[0].(map[string]any)["typed_config"].(map[string]any)
	assert.Equal(t, "tls_inspect_internal", proxy["cluster"])

	internal := listeners["tls_inspect_internal"]
	for _, c := range internal["filter_chains"].([]any) {
		chain := c.(map[string]any)
		first := chain["filters"].([]any)[0].(map[string]any)
		if first["name"] == "envoy.filters.network.http_connection_manager" {
			httpFilters := first["typed_config"].(map[string]any)["http_filters"].([]any)
			assert.Equal(t, "envoy.filters.http.ext_authz", httpFilters[0].(map[string]any)["name"],
				"a terminating chain checks egress before injecting or dialing")
			continue
		}
		assert.Equal(t, "envoy.filters.network.ext_authz", first["name"],
			"the SNI-miss chain checks egress before it passes anything through")
	}

	container, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, nil, false)
	require.NoError(t, err)
	assert.NotContains(t, bootstrapListeners(t, mustParseBootstrap(t, container)), "transparent_tls")
}

// TEST_SCENARIO: the machine resolver is what closes DNS exfiltration. It must answer every A with the gateway's address from the controller, refuse every type that could carry an answer back, and hold no plugin that forwards, recurses or logs — so a name the agent looks up never leaves the gateway and is never written anywhere.
func TestTheMachineResolverAnswersLocallyAndForwardsNothing(t *testing.T) {
	for _, plugin := range []string{"forward", "proxy", "grpc", "etcd", "kubernetes", "file", "log", "dnstap", "hosts"} {
		for _, line := range strings.Split(machineDNSCorefile, "\n") {
			if fields := strings.Fields(line); len(fields) > 0 {
				assert.NotEqual(t, plugin, fields[0], "the resolver carries the %q plugin", plugin)
			}
		}
	}
	assert.Contains(t, machineDNSCorefile, "template IN A {")
	assert.Contains(t, machineDNSCorefile, "IN A {$"+machineDNSGatewayIPEnv+"}")
	assert.Contains(t, machineDNSCorefile, "template ANY ANY {\n        rcode REFUSED")

	cm, err := BuildEnvoyBootstrapConfigMap("inst-1", "", true, bootstrapTestCfg, configMapOwnerRef(testOwnerCM), nil, nil)
	require.NoError(t, err)
	assert.Equal(t, machineDNSCorefile, cm.Data[machineDNSCorefileKey])

	cm, err = BuildEnvoyBootstrapConfigMap("inst-1", "", false, bootstrapTestCfg, configMapOwnerRef(testOwnerCM), nil, nil)
	require.NoError(t, err)
	assert.NotContains(t, cm.Data, machineDNSCorefileKey)
}

// TEST_SCENARIO: the resolver runs beside Envoy only in a machine's gateway, answers with the address it was handed, and keeps a single capability. CoreDNS's binary carries the bind capability as a file capability, which the kernel refuses to exec outside the bounding set — dropping it too leaves a gateway pod that never starts.
func TestTheResolverSidecarRunsOnlyInAMachinesGateway(t *testing.T) {
	ss := BuildGatewayStatefulSet("my-instance", testOwner, false, "172.30.1.2", testConfig, configMapOwnerRef(testOwnerCM), nil, nil)
	containers := ss.Spec.Template.Spec.Containers
	require.Len(t, containers, 2)
	dns := containers[1]
	assert.Equal(t, "machine-dns", dns.Name)
	assert.Equal(t, testConfig.MachineDNSImage, dns.Image)
	assert.Equal(t, []corev1.EnvVar{{Name: machineDNSGatewayIPEnv, Value: "172.30.1.2"}}, dns.Env)
	assert.Equal(t, []corev1.Capability{"ALL"}, dns.SecurityContext.Capabilities.Drop)
	assert.Equal(t, []corev1.Capability{"NET_BIND_SERVICE"}, dns.SecurityContext.Capabilities.Add)
	assert.True(t, *dns.SecurityContext.RunAsNonRoot)
	assert.True(t, *dns.SecurityContext.ReadOnlyRootFilesystem)

	container := BuildGatewayStatefulSet("my-instance", testOwner, false, "", testConfig, configMapOwnerRef(testOwnerCM), nil, nil)
	assert.Len(t, container.Spec.Template.Spec.Containers, 1)
}

// TEST_SCENARIO: once every name resolves to the gateway, a machine connects to it on the ordinary ports. 443 reaches the transparent TLS listener, 80 the proxy listener that routes by Host, and 53 the resolver over UDP and TCP. A container agent's gateway exposes the proxy port alone.
func TestAMachinesGatewayServiceCarriesTheOrdinaryPorts(t *testing.T) {
	svc := BuildGatewayService("my-instance", true, testConfig, configMapOwnerRef(testOwnerCM))
	got := map[string]string{}
	for _, p := range svc.Spec.Ports {
		got[string(p.Protocol)+"/"+itoa(p.Port)] = p.TargetPort.String()
	}
	assert.Equal(t, map[string]string{
		"/" + itoa(int32(testConfig.EnvoyPort)): itoa(int32(testConfig.EnvoyPort)),
		"TCP/80":                                itoa(int32(testConfig.EnvoyPort)),
		"TCP/443":                               itoa(gatewayTransparentTLSPort),
		"UDP/53":                                itoa(gatewayMachineDNSPort),
		"TCP/53":                                itoa(gatewayMachineDNSPort),
	}, got)

	assert.Len(t, BuildGatewayService("my-instance", false, testConfig, configMapOwnerRef(testOwnerCM)).Spec.Ports, 1)
}

// TEST_SCENARIO: an existing gateway Service is never recreated, because its ClusterIP is what a machine's allowlist and resolver name. A gateway that predates transparent egress gains the ports in place, keeping its address, and one already carrying them is left untouched.
func TestAnExistingGatewayServiceGainsThePortsInPlace(t *testing.T) {
	old := BuildGatewayService("my-instance", false, testConfig, configMapOwnerRef(testOwnerCM))
	old.Spec.ClusterIP = "172.30.9.9"
	client := fake.NewSimpleClientset(old)

	desired := BuildGatewayService("my-instance", true, testConfig, configMapOwnerRef(testOwnerCM))
	live, err := ensureGatewayService(context.Background(), client, desired, "agent", "my-instance")
	require.NoError(t, err)
	assert.Equal(t, "172.30.9.9", live.Spec.ClusterIP)
	assert.Len(t, live.Spec.Ports, 5)

	stored, err := client.CoreV1().Services(testConfig.Namespace).Get(context.Background(), old.Name, metav1.GetOptions{})
	require.NoError(t, err)
	assert.Len(t, stored.Spec.Ports, 5)
	assert.True(t, sameServicePorts(stored.Spec.Ports, desired.Spec.Ports))

	client.ClearActions()
	_, err = ensureGatewayService(context.Background(), client, desired, "agent", "my-instance")
	require.NoError(t, err)
	for _, a := range client.Actions() {
		assert.NotEqual(t, "update", a.GetVerb(), "a Service already carrying the ports must not be rewritten")
	}
}

func itoa(n int32) string { return strconv.Itoa(int(n)) }
