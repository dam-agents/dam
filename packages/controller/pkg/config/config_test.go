package config

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadFromEnv_AllSet(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_AGENT_NAMESPACE":   "test-agents",
		"PLATFORM_RELEASE_NAMESPACE": "custom-ns",
		"PLATFORM_RELEASE_NAME":      "my-release",
		"PLATFORM_LEASE_NAME":        "custom-lease",
		"POD_NAME":               "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "test-agents", cfg.Namespace)
	assert.Equal(t, "custom-ns", cfg.ReleaseNamespace)
	assert.Equal(t, "my-release", cfg.ReleaseName)
	assert.Equal(t, "custom-lease", cfg.LeaseName)
	assert.Equal(t, "controller-0", cfg.PodName)
}

func TestLoadFromEnv_Defaults(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":          "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "platform-agents", cfg.Namespace)
	assert.Equal(t, "default", cfg.ReleaseNamespace)
	assert.Equal(t, "platform-controller", cfg.LeaseName)
	assert.Equal(t, 1*time.Hour, cfg.IdleTimeout)
	assert.Equal(t, "", cfg.AgentStorageClass)
	// ADR-041: ext-authz host is per-instance (no shared default).
	assert.Equal(t, "platform-extauthz-inst-1.default.svc.cluster.local", cfg.ExtAuthzHostFor("inst-1"))
}

// ADR-041: per-instance ext-authz host derives from release name +
// instance ID + release namespace.
func TestExtAuthzHostFor_ComposesFQDN(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME":      "my-release",
		"PLATFORM_RELEASE_NAMESPACE": "custom-ns",
		"POD_NAME":                   "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "my-release-extauthz-abc.custom-ns.svc.cluster.local", cfg.ExtAuthzHostFor("abc"))
}

// ADR-041: principal string follows SPIFFE shape `<td>/ns/<ns>/sa/<sa>`,
// matching how istiod stamps workload certs.
func TestPrincipalFor_SPIFFEShape(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME":         "platform",
		"POD_NAME":                      "controller-0",
		"PLATFORM_AGENT_NAMESPACE":      "agents",
		"PLATFORM_ISTIO_TRUST_DOMAIN":   "td.local",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "td.local/ns/agents/sa/inst-x", cfg.PrincipalFor("inst-x"))
}

func TestLoadFromEnv_AgentStorageClass(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME":   "platform",
		"POD_NAME":            "controller-0",
		"AGENT_STORAGE_CLASS": "platform-rwx",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "platform-rwx", cfg.AgentStorageClass)
}

func TestLoadFromEnv_IdleTimeout(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":          "controller-0",
		"PLATFORM_IDLE_TIMEOUT": "30m",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, 30*time.Minute, cfg.IdleTimeout)
}

func TestLoadFromEnv_IdleTimeoutDisabled(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":          "controller-0",
		"PLATFORM_IDLE_TIMEOUT": "0s",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, time.Duration(0), cfg.IdleTimeout)
}

func TestLoadFromEnv_MissingRequired(t *testing.T) {
	setEnv(t, map[string]string{})
	_, err := LoadFromEnv()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "PLATFORM_RELEASE_NAME")
}

func TestLoadFromEnv_MissingPodName(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
	})
	_, err := LoadFromEnv()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "POD_NAME")
}

func setEnv(t *testing.T, vars map[string]string) {
	t.Helper()
	for _, key := range []string{
		"PLATFORM_AGENT_NAMESPACE", "PLATFORM_RELEASE_NAMESPACE", "PLATFORM_RELEASE_NAME",
		"PLATFORM_LEASE_NAME", "POD_NAME", "PLATFORM_IDLE_TIMEOUT",
		"AGENT_STORAGE_CLASS",
		"EXT_AUTHZ_PORT", "EXT_AUTHZ_HOLD_SECONDS",
		"PLATFORM_ISTIO_TRUST_DOMAIN", "PLATFORM_ISTIO_WAYPOINT_NAME",
	} {
		os.Unsetenv(key)
		t.Cleanup(func() { os.Unsetenv(key) })
	}
	for k, v := range vars {
		t.Setenv(k, v)
	}
}
