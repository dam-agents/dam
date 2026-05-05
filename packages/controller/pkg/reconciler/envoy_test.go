package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func ownerSecret(name, secretType, connection string) corev1.Secret {
	labels := map[string]string{
		envoyOwnerLabel:      "owner-1",
		envoyManagedByLabel:  "api-server",
		envoySecretTypeLabel: secretType,
	}
	if connection != "" {
		labels[envoyConnectionLabel] = connection
	}
	return corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:        name,
			Annotations: map[string]string{envoyHostPatternAnn: "api.example.com"},
			Labels:      labels,
		},
	}
}

func names(in []corev1.Secret) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		out = append(out, s.Name)
	}
	return out
}

func TestFilterByGrants_DefaultsToAll(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("humr-cred-aaa", "anthropic", ""),
		ownerSecret("humr-cred-bbb", "generic", ""),
		ownerSecret("humr-conn-github", "connection", "github"),
	}
	// Empty annotations → the legacy default — every owner Secret is granted.
	got := filterByGrants(secrets, nil)
	assert.ElementsMatch(t, []string{"humr-cred-aaa", "humr-cred-bbb", "humr-conn-github"}, names(got))
}

func TestFilterByGrants_SelectiveSecretsDropUngranted(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("humr-cred-aaa", "anthropic", ""),
		ownerSecret("humr-cred-bbb", "generic", ""),
	}
	got := filterByGrants(secrets, map[string]string{
		grantSecretModeAnn: "selective",
		grantSecretIdsAnn:  "aaa",
	})
	assert.Equal(t, []string{"humr-cred-aaa"}, names(got))
}

func TestFilterByGrants_SelectiveModeWithoutListGrantsNothing(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("humr-cred-aaa", "anthropic", ""),
		ownerSecret("humr-cred-bbb", "generic", ""),
	}
	// `selective` with no granted IDs is a real state — user toggled
	// everything off. Connection secrets are unaffected (no connection
	// annotation set, so the legacy "all granted" default applies to them).
	got := filterByGrants(secrets, map[string]string{
		grantSecretModeAnn: "selective",
	})
	assert.Empty(t, got)
}

func TestFilterByGrants_ConnectionAnnotationPresenceFlipsToSelective(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("humr-conn-github", "connection", "github"),
		ownerSecret("humr-conn-slack", "connection", "slack"),
	}
	// Annotation ABSENT → all granted.
	got := filterByGrants(secrets, map[string]string{})
	assert.ElementsMatch(t, []string{"humr-conn-github", "humr-conn-slack"}, names(got))

	// Annotation PRESENT (even empty) → only listed connections.
	got = filterByGrants(secrets, map[string]string{
		grantConnectionIdsAnn: "github",
	})
	assert.Equal(t, []string{"humr-conn-github"}, names(got))

	// Empty list → nothing granted.
	got = filterByGrants(secrets, map[string]string{
		grantConnectionIdsAnn: "",
	})
	assert.Empty(t, got)
}

func TestFilterByGrants_SecretAndConnectionAxesAreIndependent(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("humr-cred-aaa", "anthropic", ""),
		ownerSecret("humr-cred-bbb", "generic", ""),
		ownerSecret("humr-conn-github", "connection", "github"),
		ownerSecret("humr-conn-slack", "connection", "slack"),
	}
	got := filterByGrants(secrets, map[string]string{
		grantSecretModeAnn:    "selective",
		grantSecretIdsAnn:     "aaa",
		grantConnectionIdsAnn: "slack",
	})
	assert.ElementsMatch(t, []string{"humr-cred-aaa", "humr-conn-slack"}, names(got))
}
