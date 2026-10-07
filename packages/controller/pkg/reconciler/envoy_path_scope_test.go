package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
)

func googleWorkspaceChain() envoyHostChain {
	return connectionChain("www.googleapis.com",
		scopedCredential("conn-gmail", "platform-conn-gmail", "Authorization", "www.googleapis.com", "/gmail/*"),
		scopedCredential("conn-cal", "platform-conn-cal", "Authorization", "www.googleapis.com", "/calendar/*"),
	)
}

func TestChainScopes_DisjointPathScopesDoNotContestOneHeader(t *testing.T) {
	c := googleWorkspaceChain()

	assert.False(t, c.ContestedAt("/gmail/"),
		"Gmail and Calendar never apply to the same request, so neither shadows the other")
	assert.False(t, c.ContestedAt("/calendar/"))
}

func TestChainScopes_SamePathScopeFromTwoConnectionsContests(t *testing.T) {
	c := connectionChain("www.googleapis.com",
		scopedCredential("conn-a", "platform-conn-a", "Authorization", "www.googleapis.com", "/gmail/*"),
		scopedCredential("conn-b", "platform-conn-b", "Authorization", "www.googleapis.com", "/gmail/*"),
	)

	assert.True(t, c.ContestedAt("/gmail/"))
	assert.False(t, c.ContestedAt("/calendar/"),
		"neither credential reaches a path outside its own scope")
}

func TestChainScopes_HostWideCredentialContestsAScopedOne(t *testing.T) {
	c := connectionChain("www.googleapis.com",
		connectionCredential("conn-wide", "platform-conn-wide", "Authorization", "www.googleapis.com"),
		scopedCredential("conn-gmail", "platform-conn-gmail", "Authorization", "www.googleapis.com", "/gmail/*"),
	)

	assert.True(t, c.ContestedAt("/gmail/"),
		"the host-wide credential also covers /gmail/, so the request names no account")
	assert.False(t, c.ContestedAt("/"),
		"only the host-wide credential reaches a path outside /gmail/")
}

func TestBuildChainForwardRoutes_TwoGoogleServicesKeepForwardingOnTheirOwnPaths(t *testing.T) {
	c := googleWorkspaceChain()
	routes := buildChainForwardRoutes(c)

	for _, prefix := range []string{"/gmail/", "/calendar/", "/"} {
		route := routeNamed(t, routes, prefix)
		assert.NotContains(t, route, "direct_response",
			"path-scoped connections are not rivals, so %s still forwards", prefix)
	}
}

func TestBuildChainForwardRoutes_EachGooglePathCarriesOnlyItsOwnCredential(t *testing.T) {
	c := googleWorkspaceChain()
	gmail := c.Credentials[0]
	calendar := c.Credentials[1]
	routes := buildChainForwardRoutes(c)

	assert.Equal(t, []string{calendar.FilterName()},
		perFilterKeys(routeNamed(t, routes, "/gmail/")),
		"a Gmail request must not also carry the Calendar token")
	assert.Equal(t, []string{gmail.FilterName()},
		perFilterKeys(routeNamed(t, routes, "/calendar/")))
	assert.ElementsMatch(t, []string{gmail.FilterName(), calendar.FilterName()},
		perFilterKeys(routeNamed(t, routes, "/")),
		"neither credential claims the whole host, so the catch-all injects nothing")
}

func TestBuildChainForwardRoutes_ScopedRoutesPrecedeTheCatchAll(t *testing.T) {
	routes := buildChainForwardRoutes(googleWorkspaceChain())
	prefixes := routeMatchPrefixes(routes)

	assert.Equal(t, "/", prefixes[len(prefixes)-1],
		"Envoy takes the first matching route, so the host-wide route must come last")
	assert.Contains(t, prefixes, "/__platform_conn/conn-gmail/gmail/")
	assert.Contains(t, prefixes, "/__platform_conn/conn-cal/calendar/")
}

func TestBuildChainForwardRoutes_ContestedScopeRefusesOnlyThatPath(t *testing.T) {
	c := connectionChain("www.googleapis.com",
		scopedCredential("conn-a", "platform-conn-a", "Authorization", "www.googleapis.com", "/gmail/*"),
		scopedCredential("conn-b", "platform-conn-b", "Authorization", "www.googleapis.com", "/gmail/*"),
		scopedCredential("conn-cal", "platform-conn-cal", "Authorization", "www.googleapis.com", "/calendar/*"),
	)
	routes := buildChainForwardRoutes(c)

	assert.Contains(t, routeNamed(t, routes, "/gmail/"), "direct_response")
	assert.NotContains(t, routeNamed(t, routes, "/calendar/"), "direct_response",
		"a contest on one path must not refuse a path nobody contests")
}

func TestInjectionScope_NormalizesTheCatalogsPatterns(t *testing.T) {
	assert.Equal(t, "/gmail/", injectionScope("/gmail/*"))
	assert.Equal(t, "/", injectionScope(""))
	assert.Equal(t, "/", injectionScope("*"))
	assert.Equal(t, "/", injectionScope("/*"))
	assert.Equal(t, "/upload/drive/", injectionScope("/upload/drive/*"))
}

func TestChainsFromSecrets_GoogleServicesOnOneHostBothSurvive(t *testing.T) {
	gmail := ownerSecret("platform-conn-gmail", "connection", "conn-gmail")
	delete(gmail.Annotations, envoyHostPatternAnn)
	gmail.Annotations[envoyInjectionHostsAnn] = `[{"host":"www.googleapis.com","pathPattern":"/gmail/*","headerName":"Authorization"}]`
	gmail = withHostSDS(gmail, "www.googleapis.com")

	cal := ownerSecret("platform-conn-cal", "connection", "conn-cal")
	delete(cal.Annotations, envoyHostPatternAnn)
	cal.Annotations[envoyInjectionHostsAnn] = `[{"host":"www.googleapis.com","pathPattern":"/calendar/*","headerName":"Authorization"}]`
	cal = withHostSDS(cal, "www.googleapis.com")

	chains := chainsFromSecrets([]corev1.Secret{gmail, cal}, nil)
	require.Len(t, chains, 1)
	require.Len(t, chains[0].Credentials, 2,
		"the second Google connection is no longer dropped as a duplicate header")
	assert.False(t, chains[0].ContestedAt("/gmail/"))
	assert.False(t, chains[0].ContestedAt("/calendar/"))
}
