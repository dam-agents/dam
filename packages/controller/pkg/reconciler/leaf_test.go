package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
)

func TestBuildEnvoyLeafCertificate_NoSecrets_PlaceholderSAN(t *testing.T) {
	cert := BuildEnvoyLeafCertificate("my-instance", testConfig, configMapOwnerRef(testOwnerCM), nil, nil)
	require.NotNil(t, cert, "leaf exists even with no hosts so the ca-cert mount is stable")
	assert.Equal(t, "my-instance-envoy-tls", cert.Spec.SecretName)
	// Placeholder SAN so cert-manager mints the leaf; never presented.
	assert.Equal(t, []string{"my-instance.mitm-placeholder.invalid"}, cert.Spec.DNSNames)
}

func TestBuildEnvoyLeafCertificate_L7HostsExtendSANs(t *testing.T) {
	// A promoted host (#2865) must land on the leaf SAN list — the chain
	// terminates TLS for it — even with no credential Secrets.
	cert := BuildEnvoyLeafCertificate("my-instance", testConfig, configMapOwnerRef(testOwnerCM), nil, []string{"api.github.com"})
	require.NotNil(t, cert)
	assert.Equal(t, []string{"api.github.com"}, cert.Spec.DNSNames)
}

func TestBuildEnvoyLeafCertificate_DedupesAndSortsHosts(t *testing.T) {
	secrets := []corev1.Secret{
		credSecret("platform-cred-bbb", "b.example.com"),
		credSecret("platform-cred-aaa", "a.example.com"),
		credSecret("platform-cred-dup", "a.example.com"), // same host as -aaa
	}
	cert := BuildEnvoyLeafCertificate("my-instance", testConfig, configMapOwnerRef(testOwnerCM), secrets, nil)
	require.NotNil(t, cert)

	assert.Equal(t, "my-instance-envoy-tls", cert.Name)
	assert.Equal(t, "test-agents", cert.Namespace)
	assert.Equal(t, "my-instance-envoy-tls", cert.Spec.SecretName)

	// Sorted + deduped — keeps the spec stable across reconciles so cert-manager
	// doesn't churn the leaf renewal.
	assert.Equal(t, []string{"a.example.com", "b.example.com"}, cert.Spec.DNSNames)
}

func TestBuildEnvoyLeafCertificate_TelemetryHostInSAN_ZeroSecrets(t *testing.T) {
	cfg := *testConfig
	cfg.TelemetryCollectorHost = "platform-clickstack-collector.default.svc.cluster.local"
	// No credential Secrets: telemetry alone puts the collector host in the
	// SAN, so the gateway can MITM-terminate the agent's OTLP to it.
	cert := BuildEnvoyLeafCertificate("my-instance", &cfg, configMapOwnerRef(testOwnerCM), nil, nil)
	require.NotNil(t, cert, "telemetry-on with no Secrets must still issue a leaf for the collector SNI")
	assert.Equal(t, []string{"platform-clickstack-collector.default.svc.cluster.local"}, cert.Spec.DNSNames)
}

func TestBuildEnvoyLeafCertificate_TelemetryHostDedupedWithChainHost(t *testing.T) {
	cfg := *testConfig
	cfg.TelemetryCollectorHost = "a.example.com" // pathological: collides with a credentialed host
	secrets := []corev1.Secret{
		credSecret("platform-cred-aaa", "a.example.com"),
		credSecret("platform-cred-bbb", "b.example.com"),
	}
	cert := BuildEnvoyLeafCertificate("my-instance", &cfg, configMapOwnerRef(testOwnerCM), secrets, nil)
	require.NotNil(t, cert)
	// Collector host already present via the credentialed chain — not duplicated.
	assert.Equal(t, []string{"a.example.com", "b.example.com"}, cert.Spec.DNSNames)
}

func TestBuildEnvoyLeafCertificate_IssuerRef(t *testing.T) {
	cfg := *testConfig
	cfg.EnvoyMitmCAIssuer = "platform-mitm-ca-issuer"
	secrets := []corev1.Secret{credSecret("platform-cred-aaa", "api.example.com")}

	cert := BuildEnvoyLeafCertificate("my-instance", &cfg, configMapOwnerRef(testOwnerCM), secrets, nil)
	require.NotNil(t, cert)

	assert.Equal(t, "platform-mitm-ca-issuer", cert.Spec.IssuerRef.Name)
	assert.Equal(t, "ClusterIssuer", cert.Spec.IssuerRef.Kind)
	assert.Equal(t, "cert-manager.io", cert.Spec.IssuerRef.Group)
}

func TestBuildEnvoyLeafCertificate_OwnerReferences(t *testing.T) {
	secrets := []corev1.Secret{credSecret("platform-cred-aaa", "api.example.com")}
	cert := BuildEnvoyLeafCertificate("my-instance", testConfig, configMapOwnerRef(testOwnerCM), secrets, nil)
	require.NotNil(t, cert)

	require.Len(t, cert.OwnerReferences, 1)
	assert.Equal(t, testOwnerCM.Name, cert.OwnerReferences[0].Name)
	assert.Equal(t, testOwnerCM.UID, cert.OwnerReferences[0].UID)
}
