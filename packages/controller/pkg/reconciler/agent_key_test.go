package reconciler

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"
)

// TEST_OVERVIEW: an Agent's key reaches the Environment gate through its gateway. The api-server writes one Agent Key Secret per Agent while the Agent carries the platform's Environments rule; the gateway mounts it only for that Agent, terminates the environments domain with its leaf, injects the key in a header of its own and sends the request to the api-server's public port inside the cluster.

const testEnvironmentsDomain = "*.env.example.com"

func agentKeySecret(name, agent string) corev1.Secret {
	return corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:        name,
			Annotations: map[string]string{envoyHostPatternAnn: testEnvironmentsDomain},
			Labels: map[string]string{
				envoyOwnerLabel:      "owner-1",
				envoyManagedByLabel:  "api-server",
				envoySecretTypeLabel: envoySecretTypeAgentKey,
				LabelAgent:           agent,
			},
		},
		Data: map[string][]byte{envoyCredentialKeySDS: []byte("resources: []")},
	}
}

func agentKeyBootstrap(t *testing.T, secrets []corev1.Secret) (string, map[string]any) {
	t.Helper()
	cfg := *bootstrapTestCfg
	cfg.APIServerPort = 4000
	got, err := renderEnvoyBootstrap("agent-a", "", &cfg, chainsFromSecrets(secrets, nil), true)
	require.NoError(t, err)
	return got, mustParseBootstrap(t, got)
}

func agentKeyChainConfig(t *testing.T, doc map[string]any) map[string]any {
	t.Helper()
	chain := filterChainNamed(t, doc, "terminate_chain_agent_key_"+shortHash(testEnvironmentsDomain))
	require.NotNil(t, chain, "the Agent Key chain is rendered")
	filters, _ := chain["filters"].([]any)
	fm, _ := filters[0].(map[string]any)
	hcm, _ := fm["typed_config"].(map[string]any)
	return hcm
}

// TEST_SCENARIO: one owner holds two agents, and the api-server wrote an Agent Key Secret for each. A gateway mounts only its own Agent's key: another agent's key in its gateway would let it open what was shared with that agent.
func TestFilterByGrants_AnAgentKeyReachesOnlyItsOwnAgent(t *testing.T) {
	secrets := []corev1.Secret{agentKeySecret("agent-key-a", "agent-a"), agentKeySecret("agent-key-b", "agent-b")}
	assert.Equal(t, []string{"agent-key-a"}, names(filterByGrants("agent-a", secrets, nil, nil)))
	assert.Equal(t, []string{"agent-key-b"}, names(filterByGrants("agent-b", secrets, nil, nil)))
}

// TEST_SCENARIO: an agent fetches an Environment address. Its gateway terminates the environments domain, injects the key in its own header over whatever the agent sent, and sends the request with its Host to the api-server's public port inside the cluster, never to an address the name resolves to.
func TestAgentKeyChain_InjectsTheKeyAndSendsToTheGate(t *testing.T) {
	_, doc := agentKeyBootstrap(t, []corev1.Secret{agentKeySecret("agent-key-a", "agent-a")})
	chain := filterChainNamed(t, doc, "terminate_chain_agent_key_"+shortHash(testEnvironmentsDomain))
	match, _ := chain["filter_chain_match"].(map[string]any)
	assert.Equal(t, []any{testEnvironmentsDomain}, match["server_names"])

	hcm := agentKeyChainConfig(t, doc)
	filters, _ := hcm["http_filters"].([]any)
	var names []string
	for _, f := range filters {
		names = append(names, f.(map[string]any)["name"].(string))
	}
	assert.Equal(t, []string{"envoy.filters.http.ext_authz", "agent_key_injector", "envoy.filters.http.router"}, names,
		"ext_authz still decides, so the owner's rule for the domain is what lets the request through")

	injector := filters[1].(map[string]any)["typed_config"].(map[string]any)
	assert.Equal(t, true, injector["overwrite"], "the key overwrites a value the agent sent")
	generic := injector["credential"].(map[string]any)["typed_config"].(map[string]any)
	assert.Equal(t, agentKeyHeader, generic["header"])
	source := generic["credential"].(map[string]any)["sds_config"].(map[string]any)["path_config_source"].(map[string]any)
	assert.Equal(t, envoyCredentialsRoot+"/cred-agent-key-a/"+envoyCredentialKeySDS, source["path"])

	cluster := clusterNamed(t, doc, "environments_gate")
	require.NotNil(t, cluster)
	raw, _ := yaml.Marshal(cluster)
	assert.Contains(t, string(raw), "address: platform-apiserver.platform.svc.cluster.local")
	assert.Contains(t, string(raw), "port_value: 4000")
	assert.NotContains(t, string(raw), "transport_socket", "the api-server's public port is plain HTTP inside the cluster")
}

// TEST_SCENARIO: an agent names an Environment address in the TLS handshake but another host in the request, hoping its key reaches another route of the api-server. Only a Host under the domain is relayed; anything else is refused at the gateway, before ext_authz, and the client address headers it could have set never reach the gate.
func TestAgentKeyChain_RelaysOnlyTheDomainAndDropsClientAddresses(t *testing.T) {
	_, doc := agentKeyBootstrap(t, []corev1.Secret{agentKeySecret("agent-key-a", "agent-a")})
	hcm := agentKeyChainConfig(t, doc)
	vhosts := hcm["route_config"].(map[string]any)["virtual_hosts"].([]any)
	require.Len(t, vhosts, 2)

	env := vhosts[0].(map[string]any)
	assert.Equal(t, []any{testEnvironmentsDomain, testEnvironmentsDomain + ":*"}, env["domains"])
	route := env["routes"].([]any)[0].(map[string]any)["route"].(map[string]any)
	assert.Equal(t, "environments_gate", route["cluster"])
	assert.Subset(t, env["request_headers_to_remove"], []any{"x-forwarded-for", "x-real-ip"})

	elsewhere := vhosts[1].(map[string]any)
	assert.Equal(t, []any{"*"}, elsewhere["domains"])
	refused := elsewhere["routes"].([]any)[0].(map[string]any)
	assert.EqualValues(t, 421, refused["direct_response"].(map[string]any)["status"])

	assert.Equal(t, []any{ev{"upgrade_type": "websocket"}}, toEv(hcm["upgrade_configs"]), "an Environment's WebSocket reaches the gate too")
}

// TEST_SCENARIO: a connection the owner granted also claims the environments domain. The Agent Key chain takes the domain, so a connection's credential never reaches the gate and the key never reaches the connection's upstream.
func TestAgentKeyChain_TakesTheDomainOverAnyOtherChain(t *testing.T) {
	conn := credSecret("platform-conn-x", testEnvironmentsDomain)
	chains := chainsFromSecrets([]corev1.Secret{conn, agentKeySecret("agent-key-a", "agent-a")}, []string{testEnvironmentsDomain})
	var hosts []string
	for _, c := range chains {
		if c.Host == testEnvironmentsDomain {
			hosts = append(hosts, c.ChainID)
			require.NotNil(t, c.AgentKey)
			assert.Empty(t, c.Credentials)
		}
	}
	assert.Len(t, hosts, 1)
}

// TEST_SCENARIO: a key Secret names an exact host, or lost its key file. No chain is rendered for it, so the key is never sent to a host an agent could name and an empty key never reaches the gate.
func TestAgentKeyChain_NeedsAWildcardAndAKey(t *testing.T) {
	exact := agentKeySecret("agent-key-a", "agent-a")
	exact.Annotations[envoyHostPatternAnn] = "api.example.com"
	empty := agentKeySecret("agent-key-a", "agent-a")
	empty.Data = nil
	for _, s := range []corev1.Secret{exact, empty} {
		for _, c := range chainsFromSecrets([]corev1.Secret{s}, nil) {
			assert.Nil(t, c.AgentKey)
		}
	}
}

// TEST_SCENARIO: the key's chain terminates TLS for the environments domain, so the gateway's leaf names it; without it the agent's TLS client would refuse the gateway's certificate for an Environment address.
func TestAgentKeyChain_TheLeafNamesTheDomain(t *testing.T) {
	cert := BuildEnvoyLeafCertificate("agent-a", testConfig, configMapOwnerRef(testOwnerCM), []corev1.Secret{agentKeySecret("agent-key-a", "agent-a")}, nil)
	assert.Equal(t, []string{testEnvironmentsDomain}, cert.Spec.DNSNames)
}

// TEST_SCENARIO: an owner gateway serves two agents, one holding a key. Its key file is read from the owner Secret's flat keys, under that agent's own names, and the other agent renders no chain for the domain.
func TestRenderOwnerGateway_TheAgentKeyIsPerAgent(t *testing.T) {
	cfg := *bootstrapTestCfg
	cfg.APIServerPort = 4000
	agents := []ownerGatewayAgent{
		{Name: "agent-a", ProxyPort: 20000, Chains: chainsFromSecrets([]corev1.Secret{agentKeySecret("agent-key-a", "agent-a")}, nil)},
		{Name: "agent-b", ProxyPort: 20002},
	}
	got, err := renderOwnerGateway(agents, &cfg, nil)
	require.NoError(t, err)
	assert.Contains(t, got.LDS, "path: "+ownerGatewayCredentialRoot+"/agent-key-a."+envoyCredentialKeySDS)
	assert.Equal(t, 1, strings.Count(got.LDS, "agent_key_injector"))
	assert.Contains(t, got.CDS, "name: environments_gate_agent-a")
	assert.NotContains(t, got.CDS, "environments_gate_agent-b")
}

// TEST_SCENARIO: on an install that serves Environments the gateway reaches the api-server's public port, where the Environment gate answers; on one that does not, nothing changes.
func TestGatewayEgressReachesThePublicPortOnlyWithEnvironments(t *testing.T) {
	cfg := *testConfig
	cfg.APIServerPort = 4000
	assert.NotContains(t, apiServerPorts(&cfg), 4000)
	cfg.EnvironmentsDomain = "env.example.com"
	assert.Contains(t, apiServerPorts(&cfg), 4000)
}

// TEST_SCENARIO: the controller's Secret watch reconciles the agent an Agent Key Secret names when the Secret comes or goes, and no agent for any other Secret.
func TestAgentKeyAgent_NamesOnlyAKeysAgent(t *testing.T) {
	assert.Equal(t, "agent-a", AgentKeyAgent(agentKeySecret("agent-key-a", "agent-a").Labels))
	assert.Empty(t, AgentKeyAgent(credSecret("platform-conn-x", "api.example.com").Labels))
}

func toEv(v any) []any {
	raw, _ := v.([]any)
	out := make([]any, 0, len(raw))
	for _, x := range raw {
		if m, ok := x.(map[string]any); ok {
			out = append(out, ev(m))
		}
	}
	return out
}
