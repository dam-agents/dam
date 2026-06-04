package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
)

func TestBuildEnvoyLeafCertificate_NoSecretsReturnsNil(t *testing.T) {
	cert := BuildEnvoyLeafCertificate("my-instance", testConfig, configMapOwnerRef(testOwnerCM), nil)
	assert.Nil(t, cert, "no credential Secrets means nothing to MITM, so no leaf needed")
}

func TestBuildEnvoyLeafCertificate_DedupesAndSortsHosts(t *testing.T) {
	secrets := []corev1.Secret{
		credSecret("platform-cred-bbb", "b.example.com"),
		credSecret("platform-cred-aaa", "a.example.com"),
		credSecret("platform-cred-dup", "a.example.com"), // same host as -aaa
	}
	cert := BuildEnvoyLeafCertificate("my-instance", testConfig, configMapOwnerRef(testOwnerCM), secrets)
	require.NotNil(t, cert)

	assert.Equal(t, "my-instance-envoy-tls", cert.Name)
	assert.Equal(t, "test-agents", cert.Namespace)
	assert.Equal(t, "my-instance-envoy-tls", cert.Spec.SecretName)

	// Sorted + deduped — keeps the spec stable across reconciles so cert-manager
	// doesn't churn the leaf renewal.
	assert.Equal(t, []string{"a.example.com", "b.example.com"}, cert.Spec.DNSNames)
}

func TestBuildEnvoyLeafCertificate_IssuerRef(t *testing.T) {
	cfg := *testConfig
	cfg.EnvoyMitmCAIssuer = "platform-mitm-ca-issuer"
	secrets := []corev1.Secret{credSecret("platform-cred-aaa", "api.example.com")}

	cert := BuildEnvoyLeafCertificate("my-instance", &cfg, configMapOwnerRef(testOwnerCM), secrets)
	require.NotNil(t, cert)

	assert.Equal(t, "platform-mitm-ca-issuer", cert.Spec.IssuerRef.Name)
	assert.Equal(t, "ClusterIssuer", cert.Spec.IssuerRef.Kind)
	assert.Equal(t, "cert-manager.io", cert.Spec.IssuerRef.Group)
}

func TestBuildEnvoyLeafCertificate_OwnerReferences(t *testing.T) {
	secrets := []corev1.Secret{credSecret("platform-cred-aaa", "api.example.com")}
	cert := BuildEnvoyLeafCertificate("my-instance", testConfig, configMapOwnerRef(testOwnerCM), secrets)
	require.NotNil(t, cert)

	require.Len(t, cert.OwnerReferences, 1)
	assert.Equal(t, testOwnerCM.Name, cert.OwnerReferences[0].Name)
	assert.Equal(t, testOwnerCM.UID, cert.OwnerReferences[0].UID)
}
