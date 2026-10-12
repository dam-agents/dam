package reconciler

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildEnvoyLeafCertificate_NoSecrets_PlaceholderSAN(t *testing.T) {
	cert := BuildEnvoyLeafCertificate("my-instance", testConfig, configMapOwnerRef(testOwnerCM), nil, nil)
	require.NotNil(t, cert, "leaf exists even with no hosts so the ca-cert mount is stable")
	assert.Equal(t, "my-instance-envoy-tls", cert.Spec.SecretName)
	assert.Equal(t, []string{"my-instance.mitm-placeholder.invalid"}, cert.Spec.DNSNames)
}

func TestBuildEnvoyLeafCertificate_L7HostsExtendSANs(t *testing.T) {
	cert := BuildEnvoyLeafCertificate("my-instance", testConfig, configMapOwnerRef(testOwnerCM), nil, []string{"api.github.com"})
	require.NotNil(t, cert)
	assert.Equal(t, []string{"api.github.com"}, cert.Spec.DNSNames)
}

func TestBuildEnvoyLeafCertificate_DedupesAndSortsHosts(t *testing.T) {
	secrets := []corev1.Secret{
		credSecret("platform-cred-bbb", "b.example.com"),
		credSecret("platform-cred-aaa", "a.example.com"),
		credSecret("platform-cred-dup", "a.example.com"),
	}
	cert := BuildEnvoyLeafCertificate("my-instance", testConfig, configMapOwnerRef(testOwnerCM), secrets, nil)
	require.NotNil(t, cert)

	assert.Equal(t, "my-instance-envoy-tls", cert.Name)
	assert.Equal(t, "test-agents", cert.Namespace)
	assert.Equal(t, "my-instance-envoy-tls", cert.Spec.SecretName)

	assert.Equal(t, []string{"a.example.com", "b.example.com"}, cert.Spec.DNSNames)
}

func TestBuildEnvoyLeafCertificate_TelemetryHostInSAN_ZeroSecrets(t *testing.T) {
	cfg := *testConfig
	cfg.TelemetryCollectorHost = "platform-clickstack-collector.default.svc.cluster.local"
	cert := BuildEnvoyLeafCertificate("my-instance", &cfg, configMapOwnerRef(testOwnerCM), nil, nil)
	require.NotNil(t, cert, "telemetry-on with no Secrets must still issue a leaf for the collector SNI")
	assert.Equal(t, []string{"platform-clickstack-collector.default.svc.cluster.local"}, cert.Spec.DNSNames)
}

func TestBuildEnvoyLeafCertificate_TelemetryHostDedupedWithChainHost(t *testing.T) {
	cfg := *testConfig
	cfg.TelemetryCollectorHost = "a.example.com"
	secrets := []corev1.Secret{
		credSecret("platform-cred-aaa", "a.example.com"),
		credSecret("platform-cred-bbb", "b.example.com"),
	}
	cert := BuildEnvoyLeafCertificate("my-instance", &cfg, configMapOwnerRef(testOwnerCM), secrets, nil)
	require.NotNil(t, cert)
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

// TEST_SCENARIO: the Certificates the controller applies keep their exact rendered shape, so a change to how they are built never silently reissues every agent's and runner's certificate.
func TestAppliedCertificatesRenderExactly(t *testing.T) {
	r, _ := setupReconciler(t, agentCR())
	r.config.EnvoyMitmCAIssuer = "platform-mitm-ca-issuer"
	r.config.VMRunnerCAIssuer = "platform-vm-runner-ca-issuer"
	ctx := context.Background()
	secrets := []corev1.Secret{credSecret("platform-cred-aaa", "api.example.com")}
	require.NoError(t, r.applyCertificate(ctx, BuildEnvoyLeafCertificate("my-instance", r.config, configMapOwnerRef(testOwnerCM), secrets, nil)))
	require.NoError(t, r.applyCertificate(ctx, r.buildRunnerCertificate(testOwner, nil)))

	for name, want := range map[string]string{
		"my-instance-envoy-tls":    `{"apiVersion":"cert-manager.io/v1","kind":"Certificate","metadata":{"labels":{"agent-platform.ai/agent":"my-instance"},"name":"my-instance-envoy-tls","namespace":"test-agents","ownerReferences":[{"apiVersion":"v1","blockOwnerDeletion":true,"controller":true,"kind":"ConfigMap","name":"my-instance","uid":"cm-uid-123"}]},"spec":{"dnsNames":["api.example.com"],"issuerRef":{"group":"cert-manager.io","kind":"ClusterIssuer","name":"platform-mitm-ca-issuer"},"privateKey":{"algorithm":"ECDSA","size":256},"secretName":"my-instance-envoy-tls"},"status":{}}`,
		r.runnerTLSName(testOwner): `{"apiVersion":"cert-manager.io/v1","kind":"Certificate","metadata":{"labels":{"agent-platform.ai/owner":"owner-1","app.kubernetes.io/component":"vm-runner","app.kubernetes.io/instance":"platform","app.kubernetes.io/name":"platform"},"name":"platform-vm-runner-391887cbcf922e19-tls","namespace":"test-agents"},"spec":{"dnsNames":["platform-vm-runner-391887cbcf922e19.test-agents.svc"],"issuerRef":{"group":"cert-manager.io","kind":"ClusterIssuer","name":"platform-vm-runner-ca-issuer"},"privateKey":{"algorithm":"ECDSA","size":256},"secretName":"platform-vm-runner-391887cbcf922e19-tls","secretTemplate":{"labels":{"agent-platform.ai/owner":"owner-1","app.kubernetes.io/component":"vm-runner","app.kubernetes.io/instance":"platform","app.kubernetes.io/name":"platform"}},"usages":["digital signature","server auth"]},"status":{}}`,
	} {
		got, err := r.dynamic.Resource(certificateGVR).Namespace("test-agents").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err)
		raw, err := json.Marshal(got.Object)
		require.NoError(t, err)
		assert.Equal(t, want, string(raw), name)
	}
}
