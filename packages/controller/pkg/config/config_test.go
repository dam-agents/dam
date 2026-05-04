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
		"HUMR_AGENT_NAMESPACE":   "test-agents",
		"HUMR_RELEASE_NAMESPACE": "custom-ns",
		"HUMR_RELEASE_NAME":      "my-release",
		"HUMR_LEASE_NAME":        "custom-lease",
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
		"HUMR_RELEASE_NAME": "humr",
		"POD_NAME":          "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "humr-agents", cfg.Namespace)
	assert.Equal(t, "default", cfg.ReleaseNamespace)
	assert.Equal(t, "humr-controller", cfg.LeaseName)
	assert.Equal(t, 1*time.Hour, cfg.IdleTimeout)
	assert.Equal(t, "", cfg.AgentStorageClass)
	assert.Equal(t, "humr-apiserver.default.svc.cluster.local", cfg.ExtAuthzHost)
}

func TestLoadFromEnv_ExtAuthzHost_DefaultUsesFQDN(t *testing.T) {
	setEnv(t, map[string]string{
		"HUMR_RELEASE_NAME":      "my-release",
		"HUMR_RELEASE_NAMESPACE": "custom-ns",
		"POD_NAME":               "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "my-release-apiserver.custom-ns.svc.cluster.local", cfg.ExtAuthzHost)
}

func TestLoadFromEnv_ExtAuthzHost_OverrideWins(t *testing.T) {
	setEnv(t, map[string]string{
		"HUMR_RELEASE_NAME": "humr",
		"POD_NAME":          "controller-0",
		"EXT_AUTHZ_HOST":    "ext-authz.example.svc.cluster.local",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "ext-authz.example.svc.cluster.local", cfg.ExtAuthzHost)
}

func TestLoadFromEnv_AgentStorageClass(t *testing.T) {
	setEnv(t, map[string]string{
		"HUMR_RELEASE_NAME":   "humr",
		"POD_NAME":            "controller-0",
		"AGENT_STORAGE_CLASS": "humr-rwx",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "humr-rwx", cfg.AgentStorageClass)
}

func TestLoadFromEnv_IdleTimeout(t *testing.T) {
	setEnv(t, map[string]string{
		"HUMR_RELEASE_NAME": "humr",
		"POD_NAME":          "controller-0",
		"HUMR_IDLE_TIMEOUT": "30m",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, 30*time.Minute, cfg.IdleTimeout)
}

func TestLoadFromEnv_IdleTimeoutDisabled(t *testing.T) {
	setEnv(t, map[string]string{
		"HUMR_RELEASE_NAME": "humr",
		"POD_NAME":          "controller-0",
		"HUMR_IDLE_TIMEOUT": "0s",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, time.Duration(0), cfg.IdleTimeout)
}

func TestLoadFromEnv_MissingRequired(t *testing.T) {
	setEnv(t, map[string]string{})
	_, err := LoadFromEnv()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "HUMR_RELEASE_NAME")
}

func TestLoadFromEnv_MissingPodName(t *testing.T) {
	setEnv(t, map[string]string{
		"HUMR_RELEASE_NAME": "humr",
	})
	_, err := LoadFromEnv()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "POD_NAME")
}

func setEnv(t *testing.T, vars map[string]string) {
	t.Helper()
	for _, key := range []string{
		"HUMR_AGENT_NAMESPACE", "HUMR_RELEASE_NAMESPACE", "HUMR_RELEASE_NAME",
		"HUMR_LEASE_NAME", "POD_NAME", "HUMR_IDLE_TIMEOUT",
		"AGENT_STORAGE_CLASS",
		"EXT_AUTHZ_HOST", "EXT_AUTHZ_PORT", "EXT_AUTHZ_HOLD_SECONDS",
	} {
		os.Unsetenv(key)
		t.Cleanup(func() { os.Unsetenv(key) })
	}
	for k, v := range vars {
		t.Setenv(k, v)
	}
}
