package reconciler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// EnsurePlatformCredSecret is the controller's idempotent provisioning seam
// for the issue #108 credential. The key invariants the api-server depends
// on:
//   - re-reads return the same token (pod restarts must not invalidate
//     existing live agent sessions);
//   - SHA256(token) lives on the instance ConfigMap status, untouched by
//     re-reads.

func ownerCM(name string) *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "test-agents",
			UID:       "cm-uid-abc",
		},
	}
}

func TestEnsurePlatformCredSecret_MintsOnFirstCall(t *testing.T) {
	client := fake.NewSimpleClientset()
	ctx := context.Background()
	parent := ownerCM("my-instance")

	tok, err := EnsurePlatformCredSecret(ctx, client, "test-agents", "my-instance", parent)
	require.NoError(t, err)
	assert.NotEmpty(t, tok, "first call must mint a token")

	got, err := client.CoreV1().Secrets("test-agents").Get(ctx, PlatformCredSecretName("my-instance"), metav1.GetOptions{})
	require.NoError(t, err)

	assert.Equal(t, tok, string(got.Data[platformCredTokenKey]))
	sds := string(got.Data[platformCredSDSKey])
	assert.Contains(t, sds, "name: "+platformCredSDSName)
	assert.Contains(t, sds, "PlatformInstance "+tok,
		"SDS payload must hold the wire-shape header value Envoy will inject verbatim")

	// Owner-referenced so K8s GC removes it with the instance ConfigMap.
	require.Len(t, got.OwnerReferences, 1)
	assert.Equal(t, parent.UID, got.OwnerReferences[0].UID)

	// Labels carry the pair key so listers / debug tools can find the
	// Secret without round-tripping through the instance CM.
	assert.Equal(t, "my-instance", got.Labels[LabelPair])
	assert.Equal(t, "platform-cred", got.Labels["agent-platform.ai/secret-type"])
}

func TestEnsurePlatformCredSecret_IsIdempotent(t *testing.T) {
	client := fake.NewSimpleClientset()
	ctx := context.Background()
	parent := ownerCM("my-instance")

	first, err := EnsurePlatformCredSecret(ctx, client, "test-agents", "my-instance", parent)
	require.NoError(t, err)

	// Second call (e.g. controller restart, second reconcile) must return
	// the same token — pod restarts must not invalidate live sessions.
	second, err := EnsurePlatformCredSecret(ctx, client, "test-agents", "my-instance", parent)
	require.NoError(t, err)
	assert.Equal(t, first, second)
}

func TestEnsurePlatformCredSecret_RecreatesMalformed(t *testing.T) {
	// A Secret missing the `token` key (legacy state, hand-edit, …) is
	// recreated rather than carried forward — Envoy would otherwise loop
	// on an empty SDS load.
	bad := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      PlatformCredSecretName("my-instance"),
			Namespace: "test-agents",
		},
		Data: map[string][]byte{platformCredSDSKey: []byte("stale")},
	}
	client := fake.NewSimpleClientset(bad)
	parent := ownerCM("my-instance")

	tok, err := EnsurePlatformCredSecret(context.Background(), client, "test-agents", "my-instance", parent)
	require.NoError(t, err)
	assert.NotEmpty(t, tok)
}

func TestHashPlatformCred(t *testing.T) {
	tok := "example-token"
	sum := sha256.Sum256([]byte(tok))
	expect := hex.EncodeToString(sum[:])
	assert.Equal(t, expect, HashPlatformCred(tok))
}

func TestPlatformCredMountPath(t *testing.T) {
	// The bootstrap template hard-codes the mount path indirectly via
	// `PlatformCredMountPath()` — pinning the value catches drift between
	// the volume mount and the SDS path Envoy reads.
	assert.True(t, strings.HasPrefix(PlatformCredMountPath(), envoyCredentialsRoot+"/"),
		"platform-cred mount must live under the existing credentials root so a single rootfs lockdown covers both")
	assert.True(t, strings.HasSuffix(PlatformCredMountPath(), "/platform-cred"))
}
