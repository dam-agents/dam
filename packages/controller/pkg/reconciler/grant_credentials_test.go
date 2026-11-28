package reconciler

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// TEST_OVERVIEW: A grant of a connection can name a credential the api-server made for it, such as an API key that belongs to one agent. The agent's gateway then mounts exactly that credential's Secret for the connection and never the connection's own, also while the credential's Secret is not there yet. Every other agent that holds the connection keeps the connection's own Secret, and a credential named for another connection, or by nobody, reaches no one.

func credentialSecret(name, connection, credential string) corev1.Secret {
	s := ownerSecret(name, envoySecretTypeConnectionCredential, connection)
	s.Labels[envoyCredentialLabel] = credential
	return s
}

func credentialFor(connection, credential string) []apiv1.GrantedCredential {
	return []apiv1.GrantedCredential{{ConnectionID: connection, CredentialID: credential}}
}

func ownerSecretsWithCredentials() []corev1.Secret {
	return []corev1.Secret{
		ownerSecret("platform-conn-dam", "connection", "conn-dam"),
		credentialSecret("platform-cred-a", "conn-dam", "cred-a"),
		credentialSecret("platform-cred-b", "conn-dam", "cred-b"),
		ownerSecret("platform-conn-github", "connection", "conn-github"),
	}
}

// TEST_SCENARIO: an agent's grant of the platform connection names its own credential. Its gateway mounts that credential and not the connection's own key, and its other grants are untouched.
func TestFilterByGrants_AGrantsCredentialReplacesTheConnectionsOwn(t *testing.T) {
	got := filterByGrants("agent-a", ownerSecretsWithCredentials(), nil,
		[]string{"conn-dam", "conn-github"}, credentialFor("conn-dam", "cred-a"))
	assert.Equal(t, []string{"platform-cred-a", "platform-conn-github"}, names(got))
}

// TEST_SCENARIO: a sibling agent holds the same connection with no credential named. It keeps the connection's own Secret, and no credential made for another agent reaches it.
func TestFilterByGrants_AGrantWithNoCredentialKeepsTheConnectionsOwn(t *testing.T) {
	got := filterByGrants("agent-c", ownerSecretsWithCredentials(), nil, []string{"conn-dam"}, nil)
	assert.Equal(t, []string{"platform-conn-dam"}, names(got))
}

// TEST_SCENARIO: the grant names a credential whose Secret the api-server has not written yet, or has deleted. The gateway mounts nothing for that connection: falling back to the connection's own Secret would hand the agent the wider credential it was moved off.
func TestFilterByGrants_AMissingCredentialNeverFallsBackToTheConnectionsOwn(t *testing.T) {
	got := filterByGrants("agent-d", ownerSecretsWithCredentials(), nil,
		[]string{"conn-dam"}, credentialFor("conn-dam", "cred-not-written"))
	assert.Empty(t, got)
}

// TEST_SCENARIO: a credential is selected by the grant of its own connection only. One named for a connection the agent does not hold, or a credential label on a Secret of another connection, mounts nothing.
func TestFilterByGrants_ACredentialCountsOnlyForItsOwnGrantedConnection(t *testing.T) {
	secrets := ownerSecretsWithCredentials()
	notHeld := filterByGrants("agent-e", secrets, nil, []string{"conn-github"}, credentialFor("conn-dam", "cred-a"))
	assert.Equal(t, []string{"platform-conn-github"}, names(notHeld))

	wrongConnection := filterByGrants("agent-f", secrets, nil,
		[]string{"conn-dam", "conn-github"}, credentialFor("conn-github", "cred-a"))
	assert.Equal(t, []string{"platform-conn-dam"}, names(wrongConnection))
}

// TEST_SCENARIO: a credential Secret is rendered as the connection's own is: its injection hosts, its header and its template. For the platform connection that is the chain pinned to the api-server Service, so moving a grant onto a credential changes the key on the wire and nothing else.
func TestRenderEnvoyBootstrap_ACredentialRendersAsItsConnection(t *testing.T) {
	host := bootstrapTestCfg.APIServerHost()
	cred := credentialSecret("platform-cred-a", "conn-dam", "cred-a")
	cred.Annotations[envoySecretPurposeAnn] = "connection:dam"
	cred.Annotations[envoyInjectionHostsAnn] = fmt.Sprintf(`[{"host":%q,"pathPattern":"/api/","headerName":"Authorization"}]`, host)
	cred = withHostSDS(cred, host)

	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, chainsFromSecrets([]corev1.Secret{cred}, nil), false)
	require.NoError(t, err)
	doc := mustParseBootstrap(t, got)

	clusters := staticClusters(t, doc)
	require.Len(t, clusters, 1)
	assert.Equal(t, host, pinnedClusterHost(t, clusters[0]))
	assert.Len(t, injectorFilters(httpFiltersForHost(t, doc, host)), 1, "the credential is injected on the connection's chain")
}
