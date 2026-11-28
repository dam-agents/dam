package reconciler

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// TEST_OVERVIEW: A grant of a GitHub or platform connection can carry the agent's own scope. The connection then holds a derived credential that matches it, such as a token for some repositories or an API key that belongs to one agent, and the agent's gateway mounts exactly that derived Secret for the connection and never the connection's own, also while the derived Secret is not there yet. Every other agent that holds the connection with no scope keeps the connection's own Secret, and a derived credential named for another connection, or by nobody, reaches no one.

func derivedSecret(name, connection, key string) corev1.Secret {
	s := ownerSecret(name, envoySecretTypeConnectionDerived, connection)
	s.Labels[envoyDerivedKeyLabel] = key
	return s
}

func derivedFor(connection, key string) []apiv1.DerivedCredential {
	return []apiv1.DerivedCredential{{ConnectionID: connection, Key: key}}
}

func ownerSecretsWithDerived() []corev1.Secret {
	return []corev1.Secret{
		ownerSecret("platform-conn-dam", "connection", "conn-dam"),
		derivedSecret("platform-derived-a", "conn-dam", "agent-a"),
		derivedSecret("platform-derived-b", "conn-dam", "agent-b"),
		ownerSecret("platform-conn-github", "connection", "conn-github"),
	}
}

// TEST_SCENARIO: an agent's grant of the platform connection has a scope, whose derived credential is the agent's own key. Its gateway mounts that derived Secret and not the connection's own key, and its other grants are untouched.
func TestFilterByGrants_AScopedGrantsDerivedCredentialReplacesTheConnectionsOwn(t *testing.T) {
	got := filterByGrants("agent-a", ownerSecretsWithDerived(), nil,
		[]string{"conn-dam", "conn-github"}, derivedFor("conn-dam", "agent-a"))
	assert.Equal(t, []string{"platform-derived-a", "platform-conn-github"}, names(got))
}

// TEST_SCENARIO: a sibling agent holds the same connection with no scope. It keeps the connection's own Secret, and no derived credential made for another agent reaches it.
func TestFilterByGrants_AGrantWithNoScopeKeepsTheConnectionsOwn(t *testing.T) {
	got := filterByGrants("agent-c", ownerSecretsWithDerived(), nil, []string{"conn-dam"}, nil)
	assert.Equal(t, []string{"platform-conn-dam"}, names(got))
}

// TEST_SCENARIO: the scoped grant names a derived credential whose Secret the api-server has not written yet, or has deleted. The gateway mounts nothing for that connection: falling back to the connection's own Secret would hand the agent the wider credential its scope narrows.
func TestFilterByGrants_AMissingDerivedCredentialNeverFallsBackToTheConnectionsOwn(t *testing.T) {
	got := filterByGrants("agent-d", ownerSecretsWithDerived(), nil,
		[]string{"conn-dam"}, derivedFor("conn-dam", "derived-not-written"))
	assert.Empty(t, got)
}

// TEST_SCENARIO: a derived credential is selected by the grant of its own connection only. One named for a connection the agent does not hold, or a derived key on a Secret of another connection, mounts nothing.
func TestFilterByGrants_ADerivedCredentialCountsOnlyForItsOwnGrantedConnection(t *testing.T) {
	secrets := ownerSecretsWithDerived()
	notHeld := filterByGrants("agent-e", secrets, nil, []string{"conn-github"}, derivedFor("conn-dam", "agent-a"))
	assert.Equal(t, []string{"platform-conn-github"}, names(notHeld))

	wrongConnection := filterByGrants("agent-f", secrets, nil,
		[]string{"conn-dam", "conn-github"}, derivedFor("conn-github", "agent-a"))
	assert.Equal(t, []string{"platform-conn-dam"}, names(wrongConnection))
}

// TEST_SCENARIO: a derived Secret is rendered as the connection's own is: its injection hosts, its header and its template. For the platform connection that is the chain pinned to the api-server Service, so giving a grant a scope changes the key on the wire and nothing else.
func TestRenderEnvoyBootstrap_ADerivedCredentialRendersAsItsConnection(t *testing.T) {
	host := bootstrapTestCfg.APIServerHost()
	cred := derivedSecret("platform-derived-a", "conn-dam", "agent-a")
	cred.Annotations[envoySecretPurposeAnn] = "connection:dam"
	cred.Annotations[envoyInjectionHostsAnn] = fmt.Sprintf(`[{"host":%q,"pathPattern":"/api/","headerName":"Authorization"}]`, host)
	cred = withHostSDS(cred, host)

	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, chainsFromSecrets([]corev1.Secret{cred}, nil), false)
	require.NoError(t, err)
	doc := mustParseBootstrap(t, got)

	clusters := staticClusters(t, doc)
	require.Len(t, clusters, 1)
	assert.Equal(t, host, pinnedClusterHost(t, clusters[0]))
	assert.Len(t, injectorFilters(httpFiltersForHost(t, doc, host)), 1, "the derived credential is injected on the connection's chain")
}
