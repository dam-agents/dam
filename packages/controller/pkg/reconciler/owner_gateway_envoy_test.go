package reconciler

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"sigs.k8s.io/yaml"
)

// TEST_OVERVIEW: an owner gateway runs one Envoy for every vm Agent of an owner. Each agent gets its own listeners and clusters, named after it, on its own proxy port. Envoy rejects a whole file when two resources share a name, so a collision would take every agent of the owner down. The harness boundary between the agents of one owner is the guard each agent's listener routes the harness to.

func ownerTestAgents() []ownerGatewayAgent {
	gh := withHostSDS(ownerSecret("platform-conn-gh", "connection", "gh"), "api.github.com")
	gh.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.github.com","headerName":"Authorization"}]`
	chains := func() []envoyHostChain { return chainsFromSecrets([]corev1.Secret{gh}, []string{"l7.example"}) }
	return []ownerGatewayAgent{
		{Name: "agent-a", ProxyPort: 20000, Chains: chains()},
		{Name: "agent-b", ProxyPort: 20002, Chains: chains()},
	}
}

func resourcesOf(t *testing.T, doc string) []map[string]any {
	t.Helper()
	var parsed struct {
		Resources []map[string]any `json:"resources"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(doc), &parsed))
	return parsed.Resources
}

func collectStrings(v any, key string, out map[string]int) {
	switch x := v.(type) {
	case map[string]any:
		for k, val := range x {
			if s, ok := val.(string); ok && k == key {
				out[s]++
			}
			collectStrings(val, key, out)
		}
	case []any:
		for _, val := range x {
			collectStrings(val, key, out)
		}
	}
}

// TEST_SCENARIO: two agents with the same Connection render the same chains, so only the agent suffix keeps their listeners, clusters and stat prefixes apart. No listener name, cluster name or stat prefix may appear twice in the owner's files, or Envoy refuses them all.
func TestRenderOwnerGateway_NamesNeverCollide(t *testing.T) {
	cfg := telemetryTestCfg()
	got, err := renderOwnerGateway(ownerTestAgents(), cfg)
	require.NoError(t, err)

	listenerNames, clusterNames, statPrefixes := map[string]int{}, map[string]int{}, map[string]int{}
	for _, l := range resourcesOf(t, got.LDS) {
		listenerNames[l["name"].(string)]++
		collectStrings(l, "stat_prefix", statPrefixes)
	}
	for _, c := range resourcesOf(t, got.CDS) {
		clusterNames[c["name"].(string)]++
	}
	var boot map[string]any
	require.NoError(t, yaml.Unmarshal([]byte(got.Bootstrap), &boot))
	for _, c := range boot["static_resources"].(map[string]any)["clusters"].([]any) {
		clusterNames[c.(map[string]any)["name"].(string)]++
	}
	for _, m := range []map[string]int{listenerNames, clusterNames, statPrefixes} {
		for name, n := range m {
			assert.Equal(t, 1, n, "%s appears %d times", name, n)
		}
	}
	assert.Contains(t, listenerNames, "agent_egress_agent-a")
	assert.Contains(t, listenerNames, "agent_egress_agent-b")
	assert.Contains(t, clusterNames, "ext_authz_cluster_agent-b")
	assert.Len(t, got.Revisions, 2)
	assert.NotEqual(t, got.Revisions["agent-a"], got.Revisions["agent-b"])
}

// TEST_SCENARIO: each agent's ext_authz and spend records go to its own ext-authz Service, which is how the api-server knows the agent, so no agent's filters may name another agent's cluster or authority.
func TestRenderOwnerGateway_EachListenerNamesOnlyItsOwnAgent(t *testing.T) {
	got, err := renderOwnerGateway(ownerTestAgents(), bootstrapTestCfg)
	require.NoError(t, err)
	for _, l := range resourcesOf(t, got.LDS) {
		name := l["name"].(string)
		own, other := "agent-a", "agent-b"
		if strings.HasSuffix(name, "agent-b") {
			own, other = other, own
		}
		raw, _ := yaml.Marshal(l)
		assert.NotContains(t, string(raw), other, "listener %s names the sibling", name)
		assert.Contains(t, string(raw), own)
	}
}

func guardRoutes(t *testing.T, lds, agent string) []any {
	t.Helper()
	for _, l := range resourcesOf(t, lds) {
		if l["name"] != "harness_guard_"+agent {
			continue
		}
		hcm := l["filter_chains"].([]any)[0].(map[string]any)["filters"].([]any)[0].(map[string]any)["typed_config"].(map[string]any)
		assert.Equal(t, "REJECT_REQUEST", hcm["path_with_escaped_slashes_action"])
		assert.Equal(t, true, hcm["normalize_path"])
		return hcm["route_config"].(map[string]any)["virtual_hosts"].([]any)[0].(map[string]any)["routes"].([]any)
	}
	t.Fatalf("no harness guard for %s", agent)
	return nil
}

func guardAdmits(routes []any, path string) bool {
	for _, r := range routes {
		route := r.(map[string]any)
		if strings.HasPrefix(path, route["match"].(map[string]any)["prefix"].(string)) {
			return route["route"] != nil
		}
	}
	return false
}

// TEST_SCENARIO: the mesh sees one principal for every agent of the owner, so the guard is what keeps an agent off a sibling's harness paths. Its own path reaches the harness stamped with its name; a sibling's path, a path that only starts like its own, and any other path are refused at the gateway.
func TestRenderOwnerGateway_HarnessGuardRefusesSiblingPath(t *testing.T) {
	got, err := renderOwnerGateway(ownerTestAgents(), bootstrapTestCfg)
	require.NoError(t, err)
	routes := guardRoutes(t, got.LDS, "agent-a")
	assert.True(t, guardAdmits(routes, "/api/agents/agent-a/runtime/trpc"))
	assert.False(t, guardAdmits(routes, "/api/agents/agent-b/runtime/trpc"))
	assert.False(t, guardAdmits(routes, "/api/agents/agent-a-evil/x"))
	assert.False(t, guardAdmits(routes, "/api/agents/"))
	assert.False(t, guardAdmits(routes, "/healthz"))
	stamp := routes[0].(map[string]any)["request_headers_to_add"].([]any)[0].(map[string]any)["header"].(map[string]any)
	assert.Equal(t, harnessGuardHeader, stamp["key"])
	assert.Equal(t, "agent-a", stamp["value"])
}

// TEST_SCENARIO: a guest can name the harness by another spelling, an IP or a short name, which skips the guard's route. Such a request must never carry the guard's stamp, so every route that can reach the harness outside the guard strips the header the agent's harness policy requires, and both harness routes on the agent listener lead into the guard.
func TestRenderOwnerGateway_OnlyTheGuardStampsTheAgent(t *testing.T) {
	got, err := renderOwnerGateway(ownerTestAgents(), bootstrapTestCfg)
	require.NoError(t, err)
	for _, l := range resourcesOf(t, got.LDS) {
		name := l["name"].(string)
		raw, _ := yaml.Marshal(l)
		if strings.HasPrefix(name, "harness_guard_") {
			continue
		}
		var routeConfigs []map[string]any
		var walk func(v any)
		walk = func(v any) {
			switch x := v.(type) {
			case map[string]any:
				if _, ok := x["virtual_hosts"]; ok {
					routeConfigs = append(routeConfigs, x)
				}
				for _, val := range x {
					walk(val)
				}
			case []any:
				for _, val := range x {
					walk(val)
				}
			}
		}
		walk(l)
		for _, rc := range routeConfigs {
			if rc["name"] == "forward_otel_collector" {
				continue
			}
			rcRaw, _ := yaml.Marshal(rc)
			assert.Contains(t, string(rcRaw), harnessGuardHeader, "route config %v in %s must strip the guard header", rc["name"], name)
		}
		if strings.HasPrefix(name, "agent_egress_") {
			agent := strings.TrimPrefix(name, "agent_egress_")
			assert.Equal(t, 2, strings.Count(string(raw), "cluster: harness_guard_"+agent))
			assert.NotContains(t, string(raw), "harness_passthrough")
		}
	}
}

// TEST_SCENARIO: an owner gateway serves several agents in one Envoy, told apart only by the listener port. Each agent's OTLP route lives on its own listener, so its export carries its own attribution stamp and never a sibling's, and the route names stay apart so the access-log filter of one agent never matches another's route.
func TestRenderOwnerGateway_EachAgentsOTLPRouteStampsItself(t *testing.T) {
	got, err := renderOwnerGateway(ownerTestAgents(), telemetryTestCfg())
	require.NoError(t, err)
	seen := map[string]bool{}
	for _, l := range resourcesOf(t, got.LDS) {
		name := l["name"].(string)
		agent, ok := strings.CutPrefix(name, "agent_egress_")
		if !ok {
			continue
		}
		hcm := l["filter_chains"].([]any)[len(l["filter_chains"].([]any))-1].(map[string]any)["filters"].([]any)[0].(map[string]any)["typed_config"].(map[string]any)
		rc := hcm["route_config"].(map[string]any)
		var otlp map[string]any
		for _, r := range rc["virtual_hosts"].([]any)[0].(map[string]any)["routes"].([]any) {
			if r.(map[string]any)["match"].(map[string]any)["prefix"] == "/__platform_otlp/" {
				otlp = r.(map[string]any)
			}
		}
		require.NotNil(t, otlp, name)
		assert.Equal(t, "gateway_otlp_"+agent, otlp["name"])
		assert.Equal(t, "otel_collector", otlp["route"].(map[string]any)["cluster"], "the collector cluster is the owner's shared one")
		assert.Equal(t, []any{map[string]any{
			"header":        map[string]any{"key": "x-platform-agent-id", "value": agent},
			"append_action": "OVERWRITE_IF_EXISTS_OR_ADD",
		}}, rc["request_headers_to_add"])
		seen[agent] = true
	}
	assert.Equal(t, map[string]bool{"agent-a": true, "agent-b": true}, seen)
}

// TEST_SCENARIO: the readiness probe compares the body of an agent's health path with the revision rendered for it, so the listener must answer that path with exactly that revision, and a change to one agent's chains must change only that agent's revision.
func TestRenderOwnerGateway_HealthPathServesTheRevision(t *testing.T) {
	agents := ownerTestAgents()
	before, err := renderOwnerGateway(agents, bootstrapTestCfg)
	require.NoError(t, err)
	assert.Contains(t, before.LDS, "inline_string: "+before.Revisions["agent-a"])
	agents[1].Chains = agents[1].Chains[:1]
	after, err := renderOwnerGateway(agents, bootstrapTestCfg)
	require.NoError(t, err)
	assert.Equal(t, before.Revisions["agent-a"], after.Revisions["agent-a"])
	assert.NotEqual(t, before.Revisions["agent-b"], after.Revisions["agent-b"])
}

// TEST_SCENARIO: the owner's credentials are one Secret mounted once, its keys prefixed by the Secret they came from, so the SDS file each chain reads is that flat name and its watched directory is the mount itself.
func TestRenderOwnerGateway_CredentialsReadFromTheOwnerSecret(t *testing.T) {
	got, err := renderOwnerGateway(ownerTestAgents(), bootstrapTestCfg)
	require.NoError(t, err)
	assert.Contains(t, got.LDS, "path: "+envoyCredentialsRoot+"/platform-conn-gh."+sdsFileKeyForHost("api.github.com"))
	assert.NotContains(t, got.LDS, "/cred-")
	assert.Contains(t, got.LDS, "tls_certificate_sds_secret_configs")
	assert.NotContains(t, got.LDS, "/tls.key")
}
