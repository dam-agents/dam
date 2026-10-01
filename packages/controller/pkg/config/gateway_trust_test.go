package config

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type testCA struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
	pem  string
}

func newTestCA(t *testing.T, name string) testCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: name},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	require.NoError(t, err)
	cert, err := x509.ParseCertificate(der)
	require.NoError(t, err)
	return testCA{cert: cert, key: key, pem: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))}
}

func (ca testCA) leaf(t *testing.T, host string) *x509.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		DNSNames:     []string{host},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca.cert, &key.PublicKey, ca.key)
	require.NoError(t, err)
	cert, err := x509.ParseCertificate(der)
	require.NoError(t, err)
	return cert
}

func writeRoots(t *testing.T, pemText string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ca-certificates.crt")
	require.NoError(t, os.WriteFile(path, []byte(pemText), 0o600))
	return path
}

func verifies(t *testing.T, bundle string, leaf *x509.Certificate, host string) bool {
	t.Helper()
	pool := x509.NewCertPool()
	require.True(t, pool.AppendCertsFromPEM([]byte(bundle)))
	_, err := leaf.Verify(x509.VerifyOptions{Roots: pool, DNSName: host})
	return err == nil
}

func TestGatewayUpstreamTrustBundle_TrustsTheExtraCAOnTopOfThePublicRoots(t *testing.T) {
	public := newTestCA(t, "public root")
	inspecting := newTestCA(t, "TLS-inspecting proxy")
	base := writeRoots(t, public.pem)
	intercepted := inspecting.leaf(t, "api.anthropic.com")

	require.False(t, verifies(t, public.pem, intercepted, "api.anthropic.com"),
		"the public roots alone must not trust the intercepted certificate")

	bundle, err := GatewayUpstreamTrustBundle(base, inspecting.pem)
	require.NoError(t, err)
	assert.True(t, verifies(t, bundle, intercepted, "api.anthropic.com"))
	assert.True(t, verifies(t, bundle, public.leaf(t, "pypi.org"), "pypi.org"),
		"a host the proxy passes through still verifies against the public roots")
}

func TestGatewayUpstreamTrustBundle_TakesSeveralExtraCAs(t *testing.T) {
	first, second := newTestCA(t, "first"), newTestCA(t, "second")
	bundle, err := GatewayUpstreamTrustBundle(writeRoots(t, newTestCA(t, "public").pem), first.pem+"\n"+second.pem)
	require.NoError(t, err)
	assert.True(t, verifies(t, bundle, first.leaf(t, "a.example"), "a.example"))
	assert.True(t, verifies(t, bundle, second.leaf(t, "b.example"), "b.example"))
}

func TestGatewayUpstreamTrustBundle_RefusesWhatIsNotACertificate(t *testing.T) {
	base := writeRoots(t, newTestCA(t, "public").pem)
	ca := newTestCA(t, "extra")
	for name, extra := range map[string]string{
		"a private key":         "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n",
		"no PEM at all":         "not a certificate",
		"text after a cert":     ca.pem + "trailing words",
		"a cert that is broken": "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := GatewayUpstreamTrustBundle(base, extra)
			assert.Error(t, err)
		})
	}
}

func TestGatewayUpstreamTrustBundle_RefusesPublicRootsItCannotRead(t *testing.T) {
	ca := newTestCA(t, "extra")
	_, err := GatewayUpstreamTrustBundle(filepath.Join(t.TempDir(), "missing.crt"), ca.pem)
	assert.Error(t, err)
	_, err = GatewayUpstreamTrustBundle(writeRoots(t, "empty\n"), ca.pem)
	assert.Error(t, err)
}

func TestLoadFromEnv_GatewayUpstreamExtraCAs(t *testing.T) {
	base := map[string]string{"PLATFORM_RELEASE_NAME": "r", "POD_NAME": "p"}

	setEnv(t, base)
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Empty(t, cfg.GatewayUpstreamTrustBundle, "no extra CAs leaves the gateway on its own image's roots")

	withBad := map[string]string{"PLATFORM_GATEWAY_UPSTREAM_EXTRA_CAS": "not a certificate"}
	for k, v := range base {
		withBad[k] = v
	}
	setEnv(t, withBad)
	_, err = LoadFromEnv()
	assert.ErrorContains(t, err, "PLATFORM_GATEWAY_UPSTREAM_EXTRA_CAS")
}

func TestLoadFromEnv_GatewayRequireConnectionAddress(t *testing.T) {
	setEnv(t, map[string]string{"PLATFORM_RELEASE_NAME": "r", "POD_NAME": "p"})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.False(t, cfg.GatewayRequireConnectionAddress)

	setEnv(t, map[string]string{"PLATFORM_RELEASE_NAME": "r", "POD_NAME": "p", "PLATFORM_GATEWAY_REQUIRE_CONNECTION_ADDRESS": "true"})
	cfg, err = LoadFromEnv()
	require.NoError(t, err)
	assert.True(t, cfg.GatewayRequireConnectionAddress)
}
