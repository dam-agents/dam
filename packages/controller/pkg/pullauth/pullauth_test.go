package pullauth

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func dockerSecret(name, body string) *corev1.Secret {
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "agents"},
		Type:       corev1.SecretTypeDockerConfigJson,
		Data:       map[string][]byte{corev1.DockerConfigJsonKey: []byte(body)},
	}
}

func authsIn(t *testing.T, doc string) map[string]map[string]string {
	t.Helper()
	var parsed struct {
		Auths map[string]map[string]string `json:"auths"`
	}
	require.NoError(t, json.Unmarshal([]byte(doc), &parsed))
	return parsed.Auths
}

// TEST_SCENARIO: the container backend lists the Agent's own pull Secret ahead of the install default, and the kubelet tries them in that order. A vm fetch reads one merged document, so for a registry both Secrets name, the Agent's credential must win. The default must still cover every registry the Agent's Secret does not name, or an Agent with a credential for one registry would lose the install's credential for all the others.
func TestTheAgentsOwnSecretWinsForItsRegistryAndTheDefaultsCoverTheRest(t *testing.T) {
	client := fake.NewSimpleClientset(
		dockerSecret("agent-pull", `{"auths":{"ghcr.io":{"auth":"YWdlbnQ="}}}`),
		dockerSecret("install-default", `{"auths":{"ghcr.io":{"auth":"ZGVmYXVsdA=="},"quay.io":{"auth":"cXVheQ=="}}}`),
	)

	doc, err := Resolve(t.Context(), client.CoreV1().Secrets("agents"), []string{"agent-pull", "install-default"})
	require.NoError(t, err)

	auths := authsIn(t, doc)
	assert.Equal(t, "YWdlbnQ=", auths["ghcr.io"]["auth"], "the Agent's own credential, listed first, wins for its registry")
	assert.Equal(t, "cXVheQ==", auths["quay.io"]["auth"], "and the install default still covers a registry the Agent's Secret does not name")
}

// TEST_SCENARIO: the kubelet skips a pull Secret it cannot find or cannot parse and pulls without it, so one bad default Secret does not stop every pod. The vm backend follows the same rule. A missing Agent Secret, a missing default and a Secret of the wrong shape all leave an anonymous fetch, not a failed reconcile, and no Secret at all gives an empty document.
func TestAMissingOrMalformedSecretIsSkippedLikeTheKubeletSkipsIt(t *testing.T) {
	client := fake.NewSimpleClientset(
		dockerSecret("broken", `not json`),
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "opaque", Namespace: "agents"}, Data: map[string][]byte{"token": []byte("x")}},
	)

	doc, err := Resolve(t.Context(), client.CoreV1().Secrets("agents"), []string{"", "gone", "broken", "opaque"})
	require.NoError(t, err)
	assert.Empty(t, doc, "nothing named a registry, so there is nothing to hand the fetch")

	doc, err = Resolve(t.Context(), client.CoreV1().Secrets("agents"), nil)
	require.NoError(t, err)
	assert.Empty(t, doc)
}

// TEST_SCENARIO: a pull Secret may still be the legacy kubernetes.io/dockercfg shape, which the kubelet also reads. That shape is the bare registry map, with no auths wrapper around it. It must reach the fetch as the same credential, or an Agent that pulls fine on the container backend fails on the vm backend.
func TestALegacyDockercfgSecretIsReadAsTheSameCredential(t *testing.T) {
	client := fake.NewSimpleClientset(&corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "legacy", Namespace: "agents"},
		Type:       corev1.SecretTypeDockercfg,
		Data:       map[string][]byte{corev1.DockerConfigKey: []byte(`{"registry.example.com":{"auth":"bGVnYWN5"}}`)},
	})

	doc, err := Resolve(t.Context(), client.CoreV1().Secrets("agents"), []string{"legacy"})
	require.NoError(t, err)
	assert.Equal(t, "bGVnYWN5", authsIn(t, doc)["registry.example.com"]["auth"])
}
