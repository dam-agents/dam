package reconciler

import (
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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

func addressHeaderOf(route ev) string {
	headers, ok := route["match"].(ev)["headers"].([]any)
	if !ok || len(headers) == 0 {
		return ""
	}
	return headers[0].(ev)["string_match"].(ev)["exact"].(string)
}

func routeNamed(t *testing.T, routes []any, prefix string) ev {
	t.Helper()
	for _, r := range routes {
		route := r.(ev)
		if route["match"].(ev)["prefix"] == prefix && addressHeaderOf(route) == "" {
			return route
		}
	}
	require.FailNow(t, "no route matching prefix "+prefix)
	return nil
}

func routeAddressedTo(t *testing.T, routes []any, prefix, connectionID string) ev {
	t.Helper()
	for _, r := range routes {
		route := r.(ev)
		if route["match"].(ev)["prefix"] == prefix && addressHeaderOf(route) == connectionID {
			return route
		}
	}
	require.FailNow(t, "no route at "+prefix+" addressed to "+connectionID)
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
		route := r.(ev)
		match := route["match"].(ev)["prefix"].(string)
		if id := addressHeaderOf(route); id != "" {
			match += "@" + id
		}
		out = append(out, match)
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
		[]string{
			"/__platform_conn/conn-aaa/", "/__platform_conn/conn-bbb/",
			"/@conn-aaa", "/@conn-bbb",
			"/",
		},
		routeMatchPrefixes(routes))

	first := routes[0].(ev)
	assert.Equal(t, "/", first["route"].(ev)["prefix_rewrite"])
	assert.Equal(t, "upstream_test", first["route"].(ev)["cluster"])
}

func TestBuildChainForwardRoutes_EachConnectionAlsoAnswersToItsTokenPlaceholder(t *testing.T) {
	c := connectionChain("api.github.com",
		connectionCredential("conn-aaa", "platform-conn-aaa", "Authorization", "api.github.com"),
		connectionCredential("conn-bbb", "platform-conn-bbb", "Authorization", "api.github.com"),
	)

	route := routeAddressedTo(t, buildChainForwardRoutes(c), "/", "conn-aaa")
	header := route["match"].(ev)["headers"].([]any)[0].(ev)
	assert.Equal(t, connectionAddressHeader, header["name"])
	assert.NotContains(t, route["route"], "prefix_rewrite",
		"the path is the real one and goes upstream untouched")
	assert.Equal(t, "upstream_test", route["route"].(ev)["cluster"])
}

func TestBuildChainForwardRoutes_AddressedRouteDisablesTheRivalInjector(t *testing.T) {
	rival := connectionCredential("conn-bbb", "platform-conn-bbb", "Authorization", "mcp.slack.com")
	c := connectionChain("mcp.slack.com",
		connectionCredential("conn-aaa", "platform-conn-aaa", "Authorization", "mcp.slack.com"),
		rival,
	)

	routes := buildChainForwardRoutes(c)
	perFilter := firstRoutePerFilterConfig(t, routes)
	require.Len(t, perFilter, 1)
	disabled, ok := perFilter[rival.FilterName()].(ev)
	require.True(t, ok, "the other connection's injector is the one disabled")
	assert.Equal(t, true, disabled["disabled"])

	assert.Equal(t, perFilterKeys(routes[0].(ev)),
		perFilterKeys(routeAddressedTo(t, routes, "/", "conn-aaa")),
		"naming the connection by its token placeholder disables the same rival")
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
	assert.NotContains(t, catchAll, "typed_per_filter_config",
		"per-route disabling is decided before the address step runs, so the refusal must not switch the gate off")

	body := catchAll["direct_response"].(ev)["body"].(ev)["inline_string"].(string)
	assert.Contains(t, body, "mcp.slack.com")
	assert.Contains(t, body, "conn-aaa, conn-bbb")
	assert.Contains(t, body, "/__platform_conn/<connection-id>/")
	assert.Contains(t, body, "platform:conn:<connection-id>")
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
		[]string{
			"/__platform_conn/conn-bob/v1/", "/__platform_conn/conn-bob/",
			"/v1/@conn-bob", "/@conn-bob",
			"/v1/", "/",
		},
		routeMatchPrefixes(routes))
	assert.Equal(t, "/gateway/v1/", routes[0].(ev)["route"].(ev)["prefix_rewrite"])
	assert.Equal(t, "/", routes[1].(ev)["route"].(ev)["prefix_rewrite"])
	assert.Equal(t, "/gateway/v1/",
		routeAddressedTo(t, routes, "/v1/", "conn-bob")["route"].(ev)["prefix_rewrite"],
		"a placeholder-addressed request on a rewritten path is rewritten the same way")
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
		"/v1/@conn-aaa", "/@conn-aaa",
		"/v1/@conn-bbb", "/@conn-bbb",
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
	}, false)
	require.NoError(t, err)

	assert.NotEqual(t, a.FilterName(), b.FilterName())
	assert.Contains(t, got, a.FilterName())
	assert.Contains(t, got, b.FilterName())
	assert.Contains(t, got, "/__platform_conn/conn-aaa/")
	assert.Contains(t, got, "/__platform_conn/conn-bbb/")
	assert.Contains(t, got, "type.googleapis.com/envoy.config.route.v3.FilterConfig")
}

func TestRenderEnvoyBootstrap_ConnectionChainReadsTheAddressFirst(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		connectionChain("api.github.com",
			connectionCredential("conn-aaa", "platform-conn-aaa", "Authorization", "api.github.com"),
			connectionCredential("conn-bbb", "platform-conn-bbb", "Authorization", "api.github.com"),
		),
	}, false)
	require.NoError(t, err)

	assert.Contains(t, got, luaFilterType)
	assert.Contains(t, got, `local HEADERS = {"authorization"}`)
	assert.Contains(t, got, `local PREFIX = "platform:conn:"`)

	names := httpFilterNamesForHost(t, mustParseBootstrap(t, got), "api.github.com")
	require.GreaterOrEqual(t, len(names), 2)
	assert.Equal(t, "connection_address", names[0],
		"the address must be read before the route-bound filters look their route up")
	assert.Equal(t, "envoy.filters.http.ext_authz", names[1])
	assert.Contains(t, got, "request_headers_to_remove")
	assert.Contains(t, got, "- "+connectionAddressHeader,
		"the marker is the gateway's own and never reaches the upstream")
}

func httpFilterNamesForHost(t *testing.T, doc map[string]any, host string) []string {
	t.Helper()
	for _, fc := range internalFilterChains(t, doc) {
		match, _ := fc["filter_chain_match"].(map[string]any)
		serverNames, _ := match["server_names"].([]any)
		if len(serverNames) != 1 || serverNames[0] != host {
			continue
		}
		filters, _ := fc["filters"].([]any)
		require.NotEmpty(t, filters)
		hcm, _ := filters[0].(map[string]any)["typed_config"].(map[string]any)
		httpFilters, _ := hcm["http_filters"].([]any)
		names := make([]string, 0, len(httpFilters))
		for _, f := range httpFilters {
			names = append(names, f.(map[string]any)["name"].(string))
		}
		return names
	}
	require.FailNow(t, "no terminating chain for "+host)
	return nil
}

func httpFiltersForHost(t *testing.T, doc map[string]any, host string) []map[string]any {
	t.Helper()
	for _, fc := range internalFilterChains(t, doc) {
		match, _ := fc["filter_chain_match"].(map[string]any)
		serverNames, _ := match["server_names"].([]any)
		if len(serverNames) != 1 || serverNames[0] != host {
			continue
		}
		filters, _ := fc["filters"].([]any)
		require.NotEmpty(t, filters)
		hcm, _ := filters[0].(map[string]any)["typed_config"].(map[string]any)
		httpFilters, _ := hcm["http_filters"].([]any)
		out := make([]map[string]any, 0, len(httpFilters))
		for _, f := range httpFilters {
			out = append(out, f.(map[string]any))
		}
		return out
	}
	require.FailNow(t, "no terminating chain for "+host)
	return nil
}

func injectorFilters(filters []map[string]any) []map[string]any {
	var out []map[string]any
	for _, f := range filters {
		if name, _ := f["name"].(string); len(name) > len("credential_injector_") && name[:len("credential_injector_")] == "credential_injector_" {
			out = append(out, f)
		}
	}
	return out
}

func skippedMarkerValues(t *testing.T, filter map[string]any) []string {
	t.Helper()
	cfg := filter["typed_config"].(map[string]any)
	require.Equal(t, extensionWithMatcherType, cfg["@type"],
		"a contested injector is wrapped so it can skip itself at request time")
	tree := cfg["xds_matcher"].(map[string]any)["matcher_tree"].(map[string]any)
	input := tree["input"].(map[string]any)["typed_config"].(map[string]any)
	assert.Equal(t, connectionAddressHeader, input["header_name"])
	skips := tree["exact_match_map"].(map[string]any)["map"].(map[string]any)
	out := make([]string, 0, len(skips))
	for k := range skips {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func TestRenderEnvoyBootstrap_ContestedInjectorsSkipWhenTheMarkerNamesTheRival(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		connectionChain("api.github.com",
			connectionCredential("conn-aaa", "platform-conn-aaa", "Authorization", "api.github.com"),
			connectionCredential("conn-bbb", "platform-conn-bbb", "Authorization", "api.github.com"),
		),
	}, false)
	require.NoError(t, err)

	injectors := injectorFilters(httpFiltersForHost(t, mustParseBootstrap(t, got), "api.github.com"))
	require.Len(t, injectors, 2)
	assert.Equal(t, []string{"conn-bbb"}, skippedMarkerValues(t, injectors[0]))
	assert.Equal(t, []string{"conn-aaa"}, skippedMarkerValues(t, injectors[1]))
	inner := injectors[0]["typed_config"].(map[string]any)["extension_config"].(map[string]any)
	assert.Equal(t, "envoy.filters.http.credential_injector", inner["name"])
	assert.Equal(t, true, inner["typed_config"].(map[string]any)["overwrite"])
}

func TestRenderEnvoyBootstrap_UncontestedInjectorsStayPlain(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		connectionChain("share.example.com",
			connectionCredential("conn-kba", "platform-conn-kba", "x-kb-token-aaa", "share.example.com"),
			connectionCredential("conn-kbb", "platform-conn-kbb", "x-kb-token-bbb", "share.example.com"),
		),
		connectionChain("api.example.com",
			connectionCredential("conn-one", "platform-conn-one", "Authorization", "api.example.com"),
		),
	}, false)
	require.NoError(t, err)
	doc := mustParseBootstrap(t, got)

	for _, host := range []string{"share.example.com", "api.example.com"} {
		for _, f := range injectorFilters(httpFiltersForHost(t, doc, host)) {
			assert.Equal(t,
				"type.googleapis.com/envoy.extensions.filters.http.credential_injector.v3.CredentialInjector",
				f["typed_config"].(map[string]any)["@type"],
				"no rival claims this header on %s, so nothing is skipped", host)
		}
	}
}

func TestRivalsOf_CountsOnlyOverlappingScopesOnTheSameHeader(t *testing.T) {
	calendar := scopedCredential("conn-cal", "platform-conn-cal", "Authorization", "www.googleapis.com", "/calendar/*")
	drive := scopedCredential("conn-drive", "platform-conn-drive", "Authorization", "www.googleapis.com", "/drive/*")
	upload := scopedCredential("conn-drive", "platform-conn-drive", "Authorization", "www.googleapis.com", "/upload/drive/*")
	wholeHost := connectionCredential("conn-all", "platform-conn-all", "Authorization", "www.googleapis.com")
	otherHeader := scopedCredential("conn-key", "platform-conn-key", "X-Api-Key", "www.googleapis.com", "/calendar/*")
	c := connectionChain("www.googleapis.com", calendar, drive, upload, wholeHost, otherHeader)

	assert.Equal(t, []string{"conn-all"}, c.RivalsOf(calendar),
		"Drive's paths never overlap Calendar's, so only the whole-host credential competes for its header")
	assert.Equal(t, []string{"conn-all"}, c.RivalsOf(drive))
	assert.Equal(t, []string{"conn-cal", "conn-drive"}, c.RivalsOf(wholeHost),
		"a whole-host credential overlaps every scoped one on its header")
	assert.Empty(t, c.RivalsOf(otherHeader), "a different header is never contested")
}

func TestRenderEnvoyBootstrap_InjectorsOnDisjointScopesStayPlain(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		connectionChain("www.googleapis.com",
			scopedCredential("conn-cal", "platform-conn-cal", "Authorization", "www.googleapis.com", "/calendar/*"),
			scopedCredential("conn-drive", "platform-conn-drive", "Authorization", "www.googleapis.com", "/drive/*"),
		),
	}, false)
	require.NoError(t, err)

	injectors := injectorFilters(httpFiltersForHost(t, mustParseBootstrap(t, got), "www.googleapis.com"))
	require.Len(t, injectors, 2)
	for _, f := range injectors {
		assert.Equal(t,
			"type.googleapis.com/envoy.extensions.filters.http.credential_injector.v3.CredentialInjector",
			f["typed_config"].(map[string]any)["@type"],
			"a Drive request carrying Calendar's placeholder must still leave with the Drive credential")
	}
}

func TestLuaConnectionAddressScript_RefusesUnaddressedContestedScopesItself(t *testing.T) {
	c := connectionChain("www.googleapis.com",
		scopedCredential("conn-a", "platform-conn-a", "Authorization", "www.googleapis.com", "/gmail/*"),
		scopedCredential("conn-b", "platform-conn-b", "Authorization", "www.googleapis.com", "/gmail/*"),
		scopedCredential("conn-cal", "platform-conn-cal", "Authorization", "www.googleapis.com", "/calendar/*"),
	)

	script := luaConnectionAddressScript(c)
	assert.Contains(t, script, `{scope = "/gmail/", body = "More than one connection`)
	assert.NotContains(t, script, `scope = "/calendar/"`,
		"a scope nobody contests is never refused")
	assert.Contains(t, script, `local PATH_SEGMENT = "__platform_conn"`)
}

func TestRenderEnvoyBootstrap_UnlabelledChainReadsNoAddress(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		credentialedChain("platform-cred-legacy", "api.example.com"),
	}, false)
	require.NoError(t, err)
	assert.NotContains(t, got, "connection_address")
}

func TestLuaConnectionAddressScript_ListsEveryClaimedHeaderAndParam(t *testing.T) {
	queryParam := connectionCredential("conn-bob", "platform-conn-bob", "X-Bobshell-Cred", "bob.example.com")
	queryParam.QueryParamName = "key"
	legacy := envoyCredential{SecretName: "platform-cred-legacy", HeaderName: "X-Legacy"}
	c := connectionChain("bob.example.com",
		connectionCredential("conn-bob", "platform-conn-bob", "Authorization", "bob.example.com"),
		queryParam,
		legacy,
	)

	script := luaConnectionAddressScript(c)
	assert.Contains(t, script, `local HEADERS = {"authorization", "x-bobshell-cred"}`)
	assert.Contains(t, script, `local PARAMS = {"key"}`)
	assert.NotContains(t, script, "x-legacy",
		"a credential no connection owns has no address to read")
}

func requiringAddress(chains ...envoyHostChain) []envoyHostChain {
	for i := range chains {
		chains[i].RequireAddress = true
	}
	return chains
}

func assertInjectsOnlyWhenAddressed(t *testing.T, filter map[string]any, connectionID string) {
	t.Helper()
	cfg := filter["typed_config"].(map[string]any)
	require.Equal(t, extensionWithMatcherType, cfg["@type"])
	matchers := cfg["xds_matcher"].(map[string]any)["matcher_list"].(map[string]any)["matchers"].([]any)
	require.Len(t, matchers, 1)
	m := matchers[0].(map[string]any)
	action := m["on_match"].(map[string]any)["action"].(map[string]any)["typed_config"].(map[string]any)
	assert.Equal(t, skipFilterActionType, action["@type"])
	single := m["predicate"].(map[string]any)["not_matcher"].(map[string]any)["single_predicate"].(map[string]any)
	assert.Equal(t, connectionAddressHeader, single["input"].(map[string]any)["typed_config"].(map[string]any)["header_name"])
	assert.Equal(t, map[string]any{"exact": connectionID}, single["value_match"],
		"the injector skips every request that does not name this connection")
}

func TestRenderEnvoyBootstrap_RequireAddressGatesASingleConnection(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, requiringAddress(
		connectionChain("api.anthropic.com",
			connectionCredential("conn-one", "platform-conn-one", "Authorization", "api.anthropic.com"),
		),
	), false)
	require.NoError(t, err)

	injectors := injectorFilters(httpFiltersForHost(t, mustParseBootstrap(t, got), "api.anthropic.com"))
	require.Len(t, injectors, 1)
	assertInjectsOnlyWhenAddressed(t, injectors[0], "conn-one")
	inner := injectors[0]["typed_config"].(map[string]any)["extension_config"].(map[string]any)
	assert.Equal(t, "envoy.filters.http.credential_injector", inner["name"])
	assert.Equal(t, true, inner["typed_config"].(map[string]any)["overwrite"])
}

func TestRenderEnvoyBootstrap_RequireAddressGatesRivalsByTheirOwnAddress(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, requiringAddress(
		connectionChain("api.github.com",
			connectionCredential("conn-aaa", "platform-conn-aaa", "Authorization", "api.github.com"),
			connectionCredential("conn-bbb", "platform-conn-bbb", "Authorization", "api.github.com"),
		),
	), false)
	require.NoError(t, err)
	doc := mustParseBootstrap(t, got)

	injectors := injectorFilters(httpFiltersForHost(t, doc, "api.github.com"))
	require.Len(t, injectors, 2)
	assertInjectsOnlyWhenAddressed(t, injectors[0], "conn-aaa")
	assertInjectsOnlyWhenAddressed(t, injectors[1], "conn-bbb")
	assert.Contains(t, got, "rh:respond", "a contested scope still refuses an unaddressed request")
}

func TestRenderEnvoyBootstrap_RequireAddressGatesTheQueryParamStep(t *testing.T) {
	cred := connectionCredential("conn-q", "platform-conn-q", "X-Key", "api.example.com")
	cred.QueryParamName = "key"
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, requiringAddress(
		connectionChain("api.example.com", cred),
	), false)
	require.NoError(t, err)

	filters := httpFiltersForHost(t, mustParseBootstrap(t, got), "api.example.com")
	var queryStep map[string]any
	for _, f := range filters {
		if f["name"] == cred.QueryParamFilterName() {
			queryStep = f
		}
	}
	require.NotNil(t, queryStep)
	assertInjectsOnlyWhenAddressed(t, queryStep, "conn-q")
}

func TestRenderEnvoyBootstrap_RequireAddressLeavesCredentialsWithoutAConnectionPlain(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, requiringAddress(
		credentialedChain("platform-conn-github", "api.github.com"),
	), false)
	require.NoError(t, err)

	for _, f := range injectorFilters(httpFiltersForHost(t, mustParseBootstrap(t, got), "api.github.com")) {
		assert.Equal(t,
			"type.googleapis.com/envoy.extensions.filters.http.credential_injector.v3.CredentialInjector",
			f["typed_config"].(map[string]any)["@type"],
			"a credential with no connection has no address, so it injects as before")
	}
}

func TestEnvoyGatewayRev_RollsTheGatewayWhenRequireAddressToggles(t *testing.T) {
	assert.Equal(t, envoySecretsRev(nil, nil), envoyGatewayRev(bootstrapTestCfg, nil, nil, false),
		"an agent that leaves the flag off keeps today's revision")
	assert.NotEqual(t, envoyGatewayRev(bootstrapTestCfg, nil, nil, false), envoyGatewayRev(bootstrapTestCfg, nil, nil, true))
}

func TestBuildEnvoyBootstrapConfigMap_RequireAddressReachesEveryChain(t *testing.T) {
	owner := metav1.OwnerReference{APIVersion: "v1", Kind: "ConfigMap", Name: "owner", UID: "uid"}
	secret := ownerSecret("platform-conn-anthropic", "connection", "conn-anthropic")
	delete(secret.Annotations, envoyHostPatternAnn)
	secret.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.anthropic.com","headerName":"Authorization"}]`
	secret = withHostSDS(secret, "api.anthropic.com")

	off, err := BuildEnvoyBootstrapConfigMap("inst-1", "", false, bootstrapTestCfg, owner, []corev1.Secret{secret}, nil, false)
	require.NoError(t, err)
	on, err := BuildEnvoyBootstrapConfigMap("inst-1", "", false, bootstrapTestCfg, owner, []corev1.Secret{secret}, nil, true)
	require.NoError(t, err)
	assert.NotContains(t, off.Data["envoy.yaml"], "matcher_list")
	assert.Contains(t, on.Data["envoy.yaml"], "matcher_list")
}

func TestLuaConnectionAddressScript_ReadsAnAddressBehindAVendorPrefix(t *testing.T) {
	script := luaConnectionAddressScript(connectionChain("api.modal.com",
		connectionCredential("conn-modal", "platform-conn-modal", "x-modal-token-secret", "api.modal.com"),
	))
	assert.Contains(t, script, `local vendor = string.match(value, "^(%l+%-)")`,
		"a client that insists on a key prefix (as-, sk-) still names its connection: as-platform:conn:<id>")
	assert.Contains(t, script, `#vendor <= 9`)
}

func signingCredential(connectionID, secretName, pathPattern string) envoyCredential {
	return envoyCredential{
		ConnectionID: connectionID,
		SecretName:   secretName,
		HeaderName:   "Authorization",
		PathPattern:  pathPattern,
		VolumeName:   "cred-" + secretName,
		Signing:      &envoySigning{Region: "us-south", Service: "s3", CredentialsKey: "aws-credentials"},
	}
}

func filtersWithPrefix(filters []map[string]any, prefix string) []map[string]any {
	var out []map[string]any
	for _, f := range filters {
		if name, _ := f["name"].(string); strings.HasPrefix(name, prefix) {
			out = append(out, f)
		}
	}
	return out
}

// TEST_SCENARIO: Bob's agent leaves requireConnectionAddress off, yet a request to a shared endpoint that names no S3 Connection (such as the platform's own presigned artifact link) must pass unsigned.
func TestRenderEnvoyBootstrap_SigningStepsAreSkippedUnlessAddressedEvenWithoutRequireAddress(t *testing.T) {
	chain := connectionChain("s3.example.com", signingCredential("conn-s3", "platform-conn-s3", "/bkt"))
	require.False(t, chain.RequireAddress)
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{chain}, false)
	require.NoError(t, err)

	filters := httpFiltersForHost(t, mustParseBootstrap(t, got), "s3.example.com")
	guards := filtersWithPrefix(filters, "streaming_guard_")
	signers := filtersWithPrefix(filters, "aws_request_signing_")
	require.Len(t, guards, 1)
	require.Len(t, signers, 1)
	assertInjectsOnlyWhenAddressed(t, guards[0], "conn-s3")
	assertInjectsOnlyWhenAddressed(t, signers[0], "conn-s3")
}

func TestRenderEnvoyBootstrap_TwoSigningConnectionsOnOneHostAreNotContested(t *testing.T) {
	chain := connectionChain("s3.example.com",
		signingCredential("conn-a", "platform-conn-a", "/a"),
		signingCredential("conn-a", "platform-conn-a", "/a/*"),
		signingCredential("conn-b", "platform-conn-b", ""),
	)
	for _, cred := range chain.Credentials {
		assert.Empty(t, chain.RivalsOf(cred))
	}
	for _, scope := range chain.PathScopes() {
		assert.False(t, chain.ContestedAt(scope), scope)
	}
	assert.Empty(t, contestedScopes(chain))

	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{chain}, false)
	require.NoError(t, err)
	assert.NotContains(t, got, "direct_response", "no refusal route for two signing Connections")
	filters := httpFiltersForHost(t, mustParseBootstrap(t, got), "s3.example.com")
	assert.Len(t, filtersWithPrefix(filters, "aws_request_signing_"), 2)
}

func TestRenderEnvoyBootstrap_SigningDoesNotContestAHeaderInjectorOnTheSameHost(t *testing.T) {
	chain := connectionChain("s3.example.com",
		signingCredential("conn-s3", "platform-conn-s3", ""),
		connectionCredential("conn-other", "platform-conn-other", "Authorization", "s3.example.com"),
	)
	assert.Empty(t, chain.RivalsOf(chain.Credentials[1]))
	assert.Empty(t, chain.RivalsOf(chain.Credentials[0]))
	assert.Empty(t, contestedScopes(chain))
}

func TestLuaConnectionAddressScript_ReadsAnAddressFromASigV4Credential(t *testing.T) {
	script := luaConnectionAddressScript(connectionChain("s3.example.com",
		signingCredential("conn-s3", "platform-conn-s3", ""),
	))
	assert.Contains(t, script, `local HEADERS = {"authorization"}`)
	assert.Contains(t, script, `^AWS4%-HMAC%-SHA256%s+.-Credential=([^/,%s]+)/`,
		"the access key ID of an Authorization: AWS4-HMAC-SHA256 Credential=<key>/<date>/... header is the address")
}
