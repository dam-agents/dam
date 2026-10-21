package reconciler

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// TEST_OVERVIEW: the owner gateway mounts one Secret the controller writes, holding the credentials of every Connection granted to any of the owner's vm Agents. It is the trust boundary of the owner gateway: what is not granted, or belongs to another owner, must never be in it, and it carries only the keys the gateway reads.

func grantedConnection(owner, name, connection, host string) corev1.Secret {
	s := withHostSDS(ownerSecret(name, "connection", connection), host)
	s.Labels[envoyOwnerLabel] = owner
	s.Annotations[envoyInjectionHostsAnn] = `[{"host":"` + host + `","headerName":"Authorization","caKey":"ca.pem"}]`
	s.Data["ca.pem"] = []byte("ca")
	s.Data["not-for-the-gateway"] = []byte("x")
	return s
}

// TEST_SCENARIO: an agent's grants are resolved against the owner's own Secrets, and a Secret no vm Agent of the owner was granted, or a Secret of another owner that an Agent's list names anyway, must stay out of the owner's Secret.
func TestOwnerCredentialSecret_HoldsOnlyWhatTheOwnersAgentsAreGranted(t *testing.T) {
	cfg := bootstrapTestCfg
	all := []corev1.Secret{
		grantedConnection("owner-1", "platform-conn-gh", "gh", "api.github.com"),
		grantedConnection("owner-1", "platform-conn-ungranted", "un", "api.example.com"),
	}
	foreign := grantedConnection("owner-2", "platform-conn-foreign", "foreign", "api.foreign.com")
	agentA := filterByGrants("agent-a", all, nil, []string{"gh"})
	agentB := append(filterByGrants("agent-b", all, nil, []string{"foreign"}), foreign)

	got, _ := buildOwnerGatewaySecret("owner-1", cfg, ownerGatewayConfig{}, "", [][]corev1.Secret{agentA, agentB}, nil)
	var keys []string
	for k := range got.Data {
		if !slices.Contains(configFileKeys(got), k) {
			keys = append(keys, k)
		}
	}
	assert.ElementsMatch(t, []string{"platform-conn-gh." + sdsFileKeyForHost("api.github.com"), "platform-conn-gh.ca.pem", "platform-conn-gh.sds.yaml"}, keys)
	assert.Equal(t, "owner-1", got.Labels[envoyOwnerLabel])
	assert.Empty(t, got.OwnerReferences)
}

// TEST_SCENARIO: revoking a grant takes the Connection's keys out of the owner's Secret on the next render, and its content hash changes, which is what makes the controller write it.
func TestOwnerCredentialSecret_RevokedGrantLeaves(t *testing.T) {
	gh := grantedConnection("owner-1", "platform-conn-gh", "gh", "api.github.com")
	before, _ := buildOwnerGatewaySecret("owner-1", bootstrapTestCfg, ownerGatewayConfig{}, "", [][]corev1.Secret{{gh}}, nil)
	after, _ := buildOwnerGatewaySecret("owner-1", bootstrapTestCfg, ownerGatewayConfig{}, "", [][]corev1.Secret{{}}, nil)
	require.NotEmpty(t, credentialKeys(before))
	assert.Empty(t, credentialKeys(after))
	assert.NotEqual(t, before.Annotations[annOwnerCredentialsHash], after.Annotations[annOwnerCredentialsHash])
}

// UNIT_BOUNDARY_DESCRIPTION: the files of the gateway's own configuration, as opposed to the credentials its chains name.
func configFileKeys(secret *corev1.Secret) []string {
	var keys []string
	for _, key := range []string{ownerGatewayBootstrap, ownerGatewayLDSKey, ownerGatewayCDSKey, ownerGatewayLeafSDSKey, machineDNSCorefileKey, envoyUpstreamCAKey} {
		if _, ok := secret.Data[key]; ok {
			keys = append(keys, key)
		}
	}
	return keys
}

func credentialKeys(secret *corev1.Secret) []string {
	var keys []string
	config := configFileKeys(secret)
	for key := range secret.Data {
		if !slices.Contains(config, key) && !strings.HasSuffix(key, ".lua") {
			keys = append(keys, key)
		}
	}
	return keys
}

// TEST_SCENARIO: one leaf names every host any agent of the owner intercepts, once each, so a host added for one agent re-issues the owner's leaf and a host shared by two agents is named once.
func TestOwnerLeafCertificate_NamesTheUnionOfHosts(t *testing.T) {
	gh := grantedConnection("owner-1", "platform-conn-gh", "gh", "api.github.com")
	cert := buildOwnerLeafCertificate("owner-1", bootstrapTestCfg, []ownerLeafAgent{
		{Secrets: []corev1.Secret{gh}, L7Hosts: []string{"l7.example"}},
		{Secrets: []corev1.Secret{gh}},
	}, nil)
	assert.Equal(t, []string{"api.github.com", "l7.example"}, cert.Spec.DNSNames)
	_, isAgentLeaf := agentNameFromLeafSecret(corev1.Secret{Type: corev1.SecretTypeTLS, ObjectMeta: cert.ObjectMeta})
	assert.False(t, isAgentLeaf, "the orphan leaf sweep must not take the owner's leaf for a missing agent's")
}

// TEST_SCENARIO: the Secret is written once per change of its content, so an unchanged render sends nothing, and a change of one key's bytes, which a rotation is, rewrites it.
func TestOwnerCredentialSecret_WrittenOnlyWhenItChanges(t *testing.T) {
	client := fake.NewSimpleClientset()
	r := NewAgentReconciler(client, nil, bootstrapTestCfg)
	gh := grantedConnection("owner-1", "platform-conn-gh", "gh", "api.github.com")
	writes := func() int {
		n := 0
		for _, a := range client.Actions() {
			if a.GetResource().Resource == "secrets" && (a.GetVerb() == "create" || a.GetVerb() == "update") {
				n++
			}
		}
		return n
	}
	apply := func() error {
		files, _ := buildOwnerGatewaySecret("owner-1", bootstrapTestCfg, ownerGatewayConfig{}, "", [][]corev1.Secret{{gh}}, nil)
		return r.applyOwnerGatewayFiles(context.Background(), files)
	}
	require.NoError(t, apply())
	assert.Equal(t, 1, writes())
	require.NoError(t, apply())
	assert.Equal(t, 1, writes(), "an unchanged rendering writes nothing")
	gh.Data[envoyCredentialKeySDS] = []byte("rotated")
	require.NoError(t, apply())
	assert.Equal(t, 2, writes())
}
