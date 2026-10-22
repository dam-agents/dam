package reconciler

import (
	"net/url"
	"regexp"
	"slices"
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

// UNIT_BOUNDARY_DESCRIPTION: pathSpecifiers collects every route match specifier in a rendered bootstrap, by kind, so a test can check the shape Envoy accepts rather than only the value it routes on.
func pathSpecifiers(node any, out map[string][]string) map[string][]string {
	switch v := node.(type) {
	case map[string]any:
		for key, child := range v {
			if (key == "prefix" || key == "path_separated_prefix") && len(v) <= 2 {
				if value, ok := child.(string); ok {
					out[key] = append(out[key], value)
				}
			}
			pathSpecifiers(child, out)
		}
	case []any:
		for _, child := range v {
			pathSpecifiers(child, out)
		}
	}
	return out
}

// UNIT_BOUNDARY_DESCRIPTION: matchPrefix reads a route's path specifier, whether it is a plain prefix or a segment-safe one.
func matchPrefix(match ev) string {
	if prefix, ok := match["prefix"].(string); ok {
		return prefix
	}
	prefix, _ := match["path_separated_prefix"].(string)
	return prefix
}

func routeNamed(t *testing.T, routes []any, prefix string) ev {
	t.Helper()
	for _, r := range routes {
		route := r.(ev)
		if matchPrefix(route["match"].(ev)) == prefix && addressHeaderOf(route) == "" {
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
		if matchPrefix(route["match"].(ev)) == prefix && addressHeaderOf(route) == connectionID {
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
		match := matchPrefix(route["match"].(ev))
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

func signingConnection(connectionID, secretName string) envoySigner {
	return envoySigner{
		ConnectionID:   connectionID,
		SecretName:     secretName,
		VolumeName:     "cred-" + secretName,
		CredentialsKey: "aws-credentials",
		Region:         "us-south",
		Service:        "s3",
	}
}

func signingChain(host string, signers ...envoySigner) envoyHostChain {
	c := connectionChain(host)
	c.Signers = signers
	return c
}

// TEST_SCENARIO: An Agent that does not require addresses still must not have the platform's own presigned artifact links, or any foreign request on the endpoint, re-signed with a user's keys. Both signing steps gate on the Connection's address whatever the Agent setting says.
func TestRenderEnvoyBootstrap_SigningStepsGateOnTheAddressEvenWhenNotRequired(t *testing.T) {
	signer := signingConnection("conn-cos", "platform-conn-cos")
	chain := signingChain("s3.example.cloud", signer)
	require.False(t, chain.RequireAddress)
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{chain}, false)
	require.NoError(t, err)

	filters := httpFiltersForHost(t, mustParseBootstrap(t, got), "s3.example.cloud")
	assertInjectsOnlyWhenAddressed(t, signingFilter(t, filters, signer.GuardFilterName()), "conn-cos")
	assertInjectsOnlyWhenAddressed(t, signingFilter(t, filters, signer.FilterName()), "conn-cos")
	assert.Contains(t, got, `local HEADERS = {"authorization"}`,
		"the address step reads the key ID out of the Authorization header")
}

func TestLuaConnectionAddressScript_ReadsAnAddressFromASigV4Credential(t *testing.T) {
	script := luaConnectionAddressScript(signingChain("s3.example.cloud",
		signingConnection("conn-cos", "platform-conn-cos"),
	))
	assert.Contains(t, script, `string.match(value, "^AWS4%-HMAC%-SHA256%s+.-Credential=([^/,%s]+)/")`,
		"the access key ID in Credential=<key>/<date>/<region>/<service>/aws4_request is the placeholder")
	assert.Contains(t, script, `local HEADERS = {"authorization"}`)
}

func TestBuildChainForwardRoutes_TwoSigningConnectionsOnOneHostAreNotRivals(t *testing.T) {
	c := signingChain("s3.example.cloud",
		signingConnection("conn-aaa", "platform-conn-aaa"),
		signingConnection("conn-bbb", "platform-conn-bbb"),
	)

	assert.False(t, c.ContestedAt("/"), "signers only ever act on requests naming them, so nothing is ambiguous")
	routes := buildChainForwardRoutes(c)
	assert.Equal(t, []string{
		"/__platform_conn/conn-aaa/", "/__platform_conn/conn-bbb/",
		"/@conn-aaa", "/@conn-bbb",
		"/",
	}, routeMatchPrefixes(routes))
	for _, r := range routes {
		assert.NotContains(t, r.(ev), "direct_response")
		assert.NotContains(t, r.(ev), "typed_per_filter_config", "a signer is gated by its address, never by the route")
	}
}

func TestRenderEnvoyBootstrap_TwoSigningConnectionsOnOneHostRenderDistinctSteps(t *testing.T) {
	a := signingConnection("conn-aaa", "platform-conn-aaa")
	b := signingConnection("conn-bbb", "platform-conn-bbb")
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		signingChain("s3.example.cloud", a, b),
	}, false)
	require.NoError(t, err)

	filters := httpFiltersForHost(t, mustParseBootstrap(t, got), "s3.example.cloud")
	assertInjectsOnlyWhenAddressed(t, signingFilter(t, filters, a.FilterName()), "conn-aaa")
	assertInjectsOnlyWhenAddressed(t, signingFilter(t, filters, b.FilterName()), "conn-bbb")
	assert.Contains(t, got, "local CONTESTED = {}", "no contested scope, so the address step refuses nothing")
}

func guardScriptOf(t *testing.T, filters []map[string]any, signer envoySigner) string {
	t.Helper()
	cfg := innerFilterConfig(t, signingFilter(t, filters, signer.GuardFilterName()))
	return cfg["default_source_code"].(map[string]any)["inline_string"].(string)
}

// TEST_SCENARIO: Connection A on an endpoint is limited to the bucket scratch; Connection B on the same endpoint has no bucket, so the Agent's egress rules admit /prod there. A request naming A on /prod/... passes the egress rule B earned, and only A's own guard can keep A's keys off it. Each signer's guard carries its own Connection's scopes; a Connection without a bucket keeps signing the whole host.
func TestRenderEnvoyBootstrap_EachSignerIsBoundedByItsOwnConnectionsScopes(t *testing.T) {
	scratch := signingConnection("conn-scratch", "platform-conn-scratch")
	scratch.PathPatterns = []string{"/scratch", "/scratch?*", "/scratch/*"}
	wide := signingConnection("conn-wide", "platform-conn-wide")
	chain := signingChain("s3.example.cloud", scratch, wide)
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{chain}, false)
	require.NoError(t, err)
	filters := httpFiltersForHost(t, mustParseBootstrap(t, got), "s3.example.cloud")

	scratchScript := guardScriptOf(t, filters, scratch)
	assert.Contains(t, scratchScript, `local PATTERNS = {"^/scratch$", "^/scratch%?.*$", "^/scratch/.*$"}`)
	assert.Contains(t, scratchScript, "The storage connection conn-scratch is limited to /scratch, /scratch?*, /scratch/* on s3.example.cloud")
	assertInjectsOnlyWhenAddressed(t, signingFilter(t, filters, scratch.GuardFilterName()), "conn-scratch")

	wideScript := guardScriptOf(t, filters, wide)
	assert.Contains(t, wideScript, "local PATTERNS = {}\n", "no bucket, so the guard bounds nothing on the host")
	assert.Contains(t, wideScript, `local SCOPE_BODY = ""`)
	assert.Contains(t, wideScript, `[":status"] = "400"`, "the streaming guard still holds for a host-wide signer")
	assertInjectsOnlyWhenAddressed(t, signingFilter(t, filters, wide.GuardFilterName()), "conn-wide")

	assert.Equal(t, []string{"/"}, chain.ScopesOf("conn-scratch"), "the bound lives in the guard, not in the routes")
}

func TestBuildChainForwardRoutes_SignerBesideAHeaderInjectorLeavesTheInjectorPlain(t *testing.T) {
	injector := connectionCredential("conn-key", "platform-conn-key", "Authorization", "s3.example.cloud")
	c := connectionChain("s3.example.cloud", injector)
	c.Signers = []envoySigner{signingConnection("conn-cos", "platform-conn-cos")}

	assert.Empty(t, c.RivalsOf(injector), "a signer never claims the header, so the injector has no rival")
	assert.False(t, c.ContestedAt("/"))
	routes := buildChainForwardRoutes(c)
	catchAll := routes[len(routes)-1].(ev)
	assert.NotContains(t, catchAll, "direct_response")
	assert.Equal(t, []string{"conn-key", "conn-cos"}, c.ConnectionIDs())
}

const curveBenderHost = "litellm.cb.ete.res.ibm.com"

var curveBenderDeploymentPaths = []string{
	"/v1/models",
	"/v1/messages",
	"/v1/chat/completions",
	"/v1/responses",
}

func curveBenderDeploymentChain() envoyHostChain {
	creds := make([]envoyCredential, 0, len(curveBenderDeploymentPaths))
	for _, p := range curveBenderDeploymentPaths {
		creds = append(creds, scopedCredential("conn-cbd", "platform-conn-cbd", "Authorization", curveBenderHost, p))
	}
	return connectionChain(curveBenderHost, creds...)
}

// UNIT_BOUNDARY_DESCRIPTION: routeForPath picks the first unaddressed route a request path matches, as Envoy does on the path it has normalized.
func routeForPath(t *testing.T, routes []any, path string) ev {
	t.Helper()
	for _, r := range routes {
		route := r.(ev)
		if _, addressed := route["match"].(ev)["headers"]; addressed {
			continue
		}
		if prefix, ok := route["match"].(ev)["prefix"].(string); ok && strings.HasPrefix(path, prefix) {
			return route
		}
		if prefix, ok := route["match"].(ev)["path_separated_prefix"].(string); ok && matchesSegments(path, prefix) {
			return route
		}
	}
	require.FailNow(t, "no route matching "+path)
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: normalizeRequestPath models the HCM of a path-scoped chain — an escaped slash is refused outright, and dot segments and doubled slashes are resolved before routing, as normalize_path and merge_slashes make Envoy do.
func normalizeRequestPath(raw string) (string, bool) {
	if strings.Contains(strings.ToLower(raw), "%2f") {
		return "", false
	}
	unescaped, err := url.PathUnescape(raw)
	if err != nil {
		return "", false
	}
	out := []string{}
	for _, seg := range strings.Split(unescaped, "/") {
		switch seg {
		case "":
		case ".", "..":
			if seg == ".." && len(out) > 0 {
				out = out[:len(out)-1]
			}
		default:
			out = append(out, seg)
		}
	}
	return "/" + strings.Join(out, "/"), true
}

// UNIT_BOUNDARY_DESCRIPTION: matchesSegments models Envoy's path_separated_prefix: the prefix must end at a segment boundary, so /v1/messages admits /v1/messages and /v1/messages/x but not /v1/messagesX.
func matchesSegments(path, prefix string) bool {
	if !strings.HasPrefix(path, prefix) {
		return false
	}
	rest := path[len(prefix):]
	return rest == "" || rest[0] == '/'
}

// TEST_SCENARIO: Envoy validates a route's path_separated_prefix against `^[^?#]+[^?#/]$` and refuses the whole bootstrap when a value fails it, so every one it emits is checked on a render that carries each route shape: an exact scoped path, a scope that ends in a separator, the host-wide scope, and a rewrite.
func TestRenderEnvoyBootstrap_MatchSpecifiersPassEnvoyValidation(t *testing.T) {
	exact := connectionChain(curveBenderHost,
		scopedCredential("conn-cbd", "platform-conn-cbd", "Authorization", curveBenderHost, "/v1/messages"))
	trailing := connectionChain("api.openai.com",
		scopedCredential("conn-oai", "platform-conn-oai", "Authorization", "api.openai.com", "/v1/*"))
	bob := connectionChain("bob.example.com",
		connectionCredential("conn-bob", "platform-conn-bob", "Authorization", "bob.example.com"))
	bob.PathRewrites = []envoyPathRewrite{{Prefix: "/inference/v1/", Replacement: "/v1/"}}

	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{exact, trailing, bob}, false)
	require.NoError(t, err)
	specs := pathSpecifiers(mustParseBootstrap(t, got), map[string][]string{})

	segmentPrefix := regexp.MustCompile(`^[^?#]+[^?#/]$`)
	require.NotEmpty(t, specs["path_separated_prefix"], "an exact scoped path needs a segment-safe match")
	for _, value := range specs["path_separated_prefix"] {
		assert.Regexp(t, segmentPrefix, value, "Envoy refuses the bootstrap for this value")
	}

	// TEST_SCENARIO: a scope that already ends at a boundary stays a plain prefix, as does the host-wide scope and every rewrite.
	assert.Contains(t, specs["prefix"], "/v1/", "the OpenAI scope ends in a separator")
	assert.Contains(t, specs["prefix"], "/", "the catch-all of a host-wide chain")
	assert.Contains(t, specs["prefix"], "/inference/v1/", "Bob's rewrite happens before the catch-all")
	assert.NotContains(t, specs["path_separated_prefix"], "/v1/")
	assert.NotContains(t, specs["path_separated_prefix"], "/inference/v1/")

	// TEST_SCENARIO: the exact scoped path is segment-matched both unaddressed and under the egress prefix, so a longer path cannot borrow the key.
	assert.Contains(t, specs["path_separated_prefix"], "/v1/messages")
	assert.Contains(t, specs["path_separated_prefix"], "/__platform_conn/conn-cbd/v1/messages")
}

func TestBuildChainForwardRoutes_DeploymentKeyCoversItsOwnPathsOnly(t *testing.T) {
	c := curveBenderDeploymentChain()
	routes := buildChainForwardRoutes(c)
	creds := c.Credentials
	keyed := func(path string) bool {
		disabled := perFilterKeys(routeForPath(t, routes, path))
		for _, cred := range creds {
			if !slices.Contains(disabled, cred.FilterName()) {
				return true
			}
		}
		return false
	}

	// TEST_SCENARIO: the listing, both dialect routes and the token count under /v1/messages carry the deployment key.
	for _, path := range []string{
		"/v1/models",
		"/v1/messages",
		"/v1/messages/count_tokens",
		"/v1/chat/completions",
		"/v1/responses",
	} {
		assert.True(t, keyed(path), "%s is called by the runtime and must carry the deployment key", path)
	}

	// TEST_SCENARIO: the proxy's management routes, its shared-identity routes (one identity for every user), Bob's prefix and the root carry no deployment key.
	for _, path := range []string{
		"/key/generate",
		"/user/info",
		"/spend/logs",
		"/v1/files",
		"/v1/batches",
		"/v1/vector_stores",
		"/v1/assistants",
		"/v1/threads",
		"/v1/memory",
		"/v1/mcp/servers",
		"/v1/traces",
		"/inference/v1/chat/completions",
		"/",
	} {
		assert.False(t, keyed(path), "%s must never carry the deployment key", path)
	}

	// TEST_SCENARIO: the scopes match whole path segments, so a path that only starts with one — no LiteLLM route serves either today — carries no key.
	for _, path := range []string{"/v1/messagesX", "/v1/models-foo"} {
		assert.False(t, keyed(path), "%s only begins with a scoped path, not a segment", path)
	}
}

func TestRenderEnvoyBootstrap_PathScopedChainNormalizesPaths(t *testing.T) {
	unscoped := connectionChain("api.example.com",
		connectionCredential("conn-api", "platform-conn-api", "Authorization", "api.example.com"))
	scoped := curveBenderDeploymentChain()

	for _, tc := range []struct {
		name   string
		chain  envoyHostChain
		fields bool
	}{
		{name: "the deployment CurveBender's scoped chain", chain: scoped, fields: true},
		{name: "a host-wide chain", chain: unscoped, fields: false},
	} {
		got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{tc.chain}, false)
		require.NoError(t, err)
		chain := filterChainNamed(t, mustParseBootstrap(t, got), "terminate_"+tc.chain.ChainID)
		require.NotNil(t, chain)
		hcm := chain["filters"].([]any)[0].(map[string]any)["typed_config"].(map[string]any)

		if !tc.fields {
			// TEST_SCENARIO: a chain whose credentials are host-wide keeps the raw path, since an API can address an object with an encoded slash at any path.
			assert.NotContains(t, hcm, "normalize_path", tc.name)
			assert.NotContains(t, hcm, "merge_slashes", tc.name)
			assert.NotContains(t, hcm, "path_with_escaped_slashes_action", tc.name)
			continue
		}
		// TEST_SCENARIO: a chain that routes on a path scope normalizes the path, merges slashes and refuses an escaped slash before the match, as the harness guard does.
		assert.Equal(t, true, hcm["normalize_path"], tc.name)
		assert.Equal(t, true, hcm["merge_slashes"], tc.name)
		assert.Equal(t, "REJECT_REQUEST", hcm["path_with_escaped_slashes_action"], tc.name)
	}
}

func TestBuildChainForwardRoutes_DotSegmentsCannotReachAManagementRouteKeyed(t *testing.T) {
	c := curveBenderDeploymentChain()
	routes := buildChainForwardRoutes(c)
	keyed := func(path string) bool {
		disabled := perFilterKeys(routeForPath(t, routes, path))
		for _, cred := range c.Credentials {
			if !slices.Contains(disabled, cred.FilterName()) {
				return true
			}
		}
		return false
	}

	// TEST_SCENARIO: a path that steps out of a scoped prefix lands on the host-wide route once the chain's HCM has normalized it, and carries no key; a dot segment that rides inside a scoped prefix still selects the scoped route on the raw path, so normalization is what keeps the key off it.
	for _, tc := range []struct {
		raw        string
		keyedOnRaw bool
	}{
		{raw: "/v1/messages/../../../key/generate", keyedOnRaw: true},
		{raw: "/v1/chat/completions/../../../spend/logs", keyedOnRaw: true},
		{raw: "/v1/models/../../key/delete", keyedOnRaw: true},
		{raw: "/v1/responses/%2e%2e/%2e%2e/key/generate", keyedOnRaw: true},
		{raw: "/v1/../key/generate"},
		{raw: "/v1/%2e%2e/key/generate"},
		{raw: "/inference/v1/../../key/delete"},
		{raw: "/v1//../../spend/logs"},
	} {
		norm, accepted := normalizeRequestPath(tc.raw)
		require.True(t, accepted, "%s carries no escaped slash", tc.raw)
		assert.NotEqual(t, tc.raw, norm, "%s has a dot segment to resolve", tc.raw)
		assert.False(t, keyed(norm), "%s resolves to %s and must carry no key", tc.raw, norm)
		assert.Equal(t, tc.keyedOnRaw, keyed(tc.raw),
			"%s: whether the raw path already selects a scoped route", tc.raw)
	}

	// TEST_SCENARIO: a path with an escaped slash is refused before it is routed, so it never reaches the proxy keyed.
	_, accepted := normalizeRequestPath("/v1/..%2Fkey%2Fgenerate")
	assert.False(t, accepted)
}
