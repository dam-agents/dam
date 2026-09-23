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

// TEST_SCENARIO: the container backend lists the Agent's own pull Secret ahead of the install default, and the kubelet tries them in that order. When the Agent's credential for a registry is stale, the default for the same registry still pulls. So both documents must reach the runner, in that order, and neither may overwrite the other. A merge that kept one credential per registry would lose exactly that fallback.
func TestEverySecretReachesTheFetchInTheOrderAPodListsThem(t *testing.T) {
	client := fake.NewSimpleClientset(
		dockerSecret("agent-pull", `{"auths":{"ghcr.io":{"auth":"YWdlbnQ="}}}`),
		dockerSecret("install-default", `{"auths":{"ghcr.io":{"auth":"ZGVmYXVsdA=="},"quay.io":{"auth":"cXVheQ=="}}}`),
	)

	docs, err := Resolve(t.Context(), client.CoreV1().Secrets("agents"), []string{"agent-pull", "install-default", "agent-pull"})
	require.NoError(t, err)

	require.Len(t, docs, 2, "one document per Secret, each named once")
	assert.Equal(t, "YWdlbnQ=", authsIn(t, docs[0])["ghcr.io"]["auth"], "the Agent's own Secret is tried first")
	assert.Equal(t, "ZGVmYXVsdA==", authsIn(t, docs[1])["ghcr.io"]["auth"], "and the default's credential for the same registry is still there to fall back to")
	assert.Equal(t, "cXVheQ==", authsIn(t, docs[1])["quay.io"]["auth"])
}

// TEST_SCENARIO: the kubelet skips a pull Secret it cannot find or cannot parse and pulls without it, so one bad default Secret does not stop every pod. The vm backend follows the same rule. A missing Agent Secret, a missing default and a Secret of the wrong shape all leave an anonymous fetch, not a failed reconcile, and no Secret at all gives an empty list.
func TestAMissingOrMalformedSecretIsSkippedLikeTheKubeletSkipsIt(t *testing.T) {
	client := fake.NewSimpleClientset(
		dockerSecret("broken", `not json`),
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "opaque", Namespace: "agents"}, Data: map[string][]byte{"token": []byte("x")}},
	)

	docs, err := Resolve(t.Context(), client.CoreV1().Secrets("agents"), []string{"", "gone", "broken", "opaque"})
	require.NoError(t, err)
	assert.Empty(t, docs, "nothing named a registry, so there is nothing to hand the fetch")

	docs, err = Resolve(t.Context(), client.CoreV1().Secrets("agents"), nil)
	require.NoError(t, err)
	assert.Empty(t, docs)
}

// TEST_SCENARIO: a pull Secret may still be the legacy kubernetes.io/dockercfg shape, which the kubelet also reads. That shape is the bare registry map, with no auths wrapper around it. It must reach the fetch as the same credential, or an Agent that pulls fine on the container backend fails on the vm backend.
func TestALegacyDockercfgSecretIsReadAsTheSameCredential(t *testing.T) {
	client := fake.NewSimpleClientset(&corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "legacy", Namespace: "agents"},
		Type:       corev1.SecretTypeDockercfg,
		Data:       map[string][]byte{corev1.DockerConfigKey: []byte(`{"registry.example.com":{"auth":"bGVnYWN5"}}`)},
	})

	docs, err := Resolve(t.Context(), client.CoreV1().Secrets("agents"), []string{"legacy"})
	require.NoError(t, err)
	require.Len(t, docs, 1)
	assert.Equal(t, "bGVnYWN5", authsIn(t, docs[0])["registry.example.com"]["auth"], "handed on in the auths shape crane reads")
}
