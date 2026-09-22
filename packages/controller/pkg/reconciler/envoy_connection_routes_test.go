package reconciler

import (
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func connectionChain(host string, creds ...envoyCredential) envoyHostChain {
	return envoyHostChain{
		ChainID:         "chain_test",
		UpstreamCluster: "upstream_test",
		Host:            host,
		Credentials:     creds,
	}
}

func connectionCredential(connectionID, secretName, header, host string) envoyCredential {
	return envoyCredential{
		ConnectionID: connectionID,
		SecretName:   secretName,
		HeaderName:   header,
		VolumeName:   "cred-" + secretName,
		SDSFileKey:   sdsFileKeyForHost(host),
	}
}

func scopedCredential(connectionID, secretName, header, host, pathPattern string) envoyCredential {
	cred := connectionCredential(connectionID, secretName, header, host)
	cred.PathPattern = pathPattern
	return cred
}

func routeNamed(t *testing.T, routes []any, prefix string) ev {
	t.Helper()
	for _, r := range routes {
		if r.(ev)["match"].(ev)["prefix"] == prefix {
			return r.(ev)
		}
	}
	require.FailNow(t, "no route matching prefix "+prefix)
	return nil
}

func perFilterKeys(route ev) []string {
	cfg, ok := route["typed_per_filter_config"].(ev)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(cfg))
	for k := range cfg {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func routeMatchPrefixes(routes []any) []string {
	out := make([]string, 0, len(routes))
	for _, r := range routes {
		out = append(out, r.(ev)["match"].(ev)["prefix"].(string))
	}
	return out
}

func firstRoutePerFilterConfig(t *testing.T, routes []any) ev {
	t.Helper()
	cfg, ok := routes[0].(ev)["typed_per_filter_config"].(ev)
	require.True(t, ok, "addressed route carries per-filter overrides")
	return cfg
}

func TestBuildChainForwardRoutes_EachConnectionGetsItsOwnAddressedRoute(t *testing.T) {
	c := connectionChain("mcp.slack.com",
		connectionCredential("conn-aaa", "platform-conn-aaa", "Authorization", "mcp.slack.com"),
		connectionCredential("conn-bbb", "platform-conn-bbb", "Authorization", "mcp.slack.com"),
	)

	routes := buildChainForwardRoutes(c)
	assert.Equal(t,
		[]string{"/__platform_conn/conn-aaa/", "/__platform_conn/conn-bbb/", "/"},
		routeMatchPrefixes(routes))

	first := routes[0].(ev)
	assert.Equal(t, "/", first["route"].(ev)["prefix_rewrite"])
	assert.Equal(t, "upstream_test", first["route"].(ev)["cluster"])
}

func TestBuildChainForwardRoutes_AddressedRouteDisablesTheRivalInjector(t *testing.T) {
	rival := connectionCredential("conn-bbb", "platform-conn-bbb", "Authorization", "mcp.slack.com")
	c := connectionChain("mcp.slack.com",
		connectionCredential("conn-aaa", "platform-conn-aaa", "Authorization", "mcp.slack.com"),
		rival,
	)

	perFilter := firstRoutePerFilterConfig(t, buildChainForwardRoutes(c))
	require.Len(t, perFilter, 1)
	disabled, ok := perFilter[rival.FilterName()].(ev)
	require.True(t, ok, "the other connection's injector is the one disabled")
	assert.Equal(t, true, disabled["disabled"])
}

func TestBuildChainForwardRoutes_ContestedHostRefusesTheUnaddressedPath(t *testing.T) {
	c := connectionChain("mcp.slack.com",
		connectionCredential("conn-aaa", "platform-conn-aaa", "Authorization", "mcp.slack.com"),
		connectionCredential("conn-bbb", "platform-conn-bbb", "Authorization", "mcp.slack.com"),
	)

	routes := buildChainForwardRoutes(c)
	catchAll := routes[len(routes)-1].(ev)
	assert.Equal(t, "/", catchAll["match"].(ev)["prefix"])
	require.Contains(t, catchAll, "direct_response")
	assert.Equal(t, 403, catchAll["direct_response"].(ev)["status"])
	assert.NotContains(t, catchAll, "route")
	assert.Contains(t, catchAll, "typed_per_filter_config")

	body := catchAll["direct_response"].(ev)["body"].(ev)["inline_string"].(string)
	assert.Contains(t, body, "mcp.slack.com")
	assert.Contains(t, body, "conn-aaa, conn-bbb")
}

func TestBuildChainForwardRoutes_ComplementaryHeadersKeepTheInjectingCatchAll(t *testing.T) {
	c := connectionChain("share.example.com",
		connectionCredential("conn-kba", "platform-conn-kba", "x-kb-token-aaa", "share.example.com"),
		connectionCredential("conn-kbb", "platform-conn-kbb", "x-kb-token-bbb", "share.example.com"),
	)

	routes := buildChainForwardRoutes(c)
	catchAll := routes[len(routes)-1].(ev)
	assert.NotContains(t, catchAll, "direct_response")
	assert.Equal(t, "upstream_test", catchAll["route"].(ev)["cluster"])
	assert.NotContains(t, routes[0].(ev), "typed_per_filter_config",
		"no header is contested, so neither connection shadows the other")
}

func TestBuildChainForwardRoutes_AddressedRouteComposesWithPathRewrites(t *testing.T) {
	c := connectionChain("bob.example.com",
		connectionCredential("conn-bob", "platform-conn-bob", "Authorization", "bob.example.com"),
	)
	c.PathRewrites = []envoyPathRewrite{{Prefix: "/v1/", Replacement: "/gateway/v1/"}}

	routes := buildChainForwardRoutes(c)
	assert.Equal(t,
		[]string{"/__platform_conn/conn-bob/v1/", "/__platform_conn/conn-bob/", "/v1/", "/"},
		routeMatchPrefixes(routes))
	assert.Equal(t, "/gateway/v1/", routes[0].(ev)["route"].(ev)["prefix_rewrite"])
	assert.Equal(t, "/", routes[1].(ev)["route"].(ev)["prefix_rewrite"])
}

func TestBuildChainForwardRoutes_ContestedHostRefusesUnaddressedRewritePaths(t *testing.T) {
	c := connectionChain("bob.example.com",
		connectionCredential("conn-aaa", "platform-conn-aaa", "Authorization", "bob.example.com"),
		connectionCredential("conn-bbb", "platform-conn-bbb", "Authorization", "bob.example.com"),
	)
	c.PathRewrites = []envoyPathRewrite{{Prefix: "/v1/", Replacement: "/gateway/v1/"}}

	assert.Equal(t, []string{
		"/__platform_conn/conn-aaa/v1/", "/__platform_conn/conn-aaa/",
		"/__platform_conn/conn-bbb/v1/", "/__platform_conn/conn-bbb/",
		"/",
	}, routeMatchPrefixes(buildChainForwardRoutes(c)),
		"an unaddressed rewrite route would stack both injectors and serve the loser's account")
}

func TestBuildChainForwardRoutes_UnlabelledCredentialKeepsTodaysSingleRoute(t *testing.T) {
	c := credentialedChain("platform-cred-legacy", "api.example.com")

	routes := buildChainForwardRoutes(c)
	assert.Equal(t, []string{"/"}, routeMatchPrefixes(routes))
	assert.NotContains(t, routes[0].(ev), "direct_response")
}

func TestRenderEnvoyBootstrap_TwoConnectionsOnOneHostRenderDistinctInjectors(t *testing.T) {
	a := connectionCredential("conn-aaa", "platform-conn-aaa", "Authorization", "mcp.slack.com")
	b := connectionCredential("conn-bbb", "platform-conn-bbb", "Authorization", "mcp.slack.com")
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		connectionChain("mcp.slack.com", a, b),
	})
	require.NoError(t, err)

	assert.NotEqual(t, a.FilterName(), b.FilterName())
	assert.Contains(t, got, a.FilterName())
	assert.Contains(t, got, b.FilterName())
	assert.Contains(t, got, "/__platform_conn/conn-aaa/")
	assert.Contains(t, got, "/__platform_conn/conn-bbb/")
	assert.Contains(t, got, "type.googleapis.com/envoy.config.route.v3.FilterConfig")
}
