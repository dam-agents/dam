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
		"POD_NAME":                   "controller-0",
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
		"POD_NAME":              "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "platform-agents", cfg.Namespace)
	assert.Equal(t, "default", cfg.ReleaseNamespace)
	assert.Equal(t, "platform-controller", cfg.LeaseName)
	// No Go-side defaults — defaults live in the Helm chart's values.yaml
	// (`controller.agent.base` / `templateDefaults`). When the env vars
	// are unset entirely the zero values are what we get.
	assert.Equal(t, AgentBase{}, cfg.AgentBase)
	// AgentHome falls back to its env-var default.
	assert.Equal(t, "/home/agent", cfg.AgentTemplateDefaults.AgentHome)
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
		"PLATFORM_RELEASE_NAME":       "platform",
		"POD_NAME":                    "controller-0",
		"PLATFORM_AGENT_NAMESPACE":    "agents",
		"PLATFORM_ISTIO_TRUST_DOMAIN": "td.local",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "td.local/ns/agents/sa/inst-x", cfg.PrincipalFor("inst-x"))
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

func TestLoadFromEnv_AgentBase_Parsed(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
		"AGENT_BASE": `{
			"imagePullSecrets": ["regcred"],
			"storageClass": "platform-rwx",
			"accessMode": "ReadWriteOnce",
			"idleTimeout": "30m",
			"terminationGracePeriod": 10,
			"runtimeClassName": "kata",
			"nodeSelector": {"workload": "agents"},
			"tolerations": [{"key": "dedicated", "operator": "Equal", "value": "agents", "effect": "NoSchedule"}],
			"probes": {"startup": {"httpGet": {"path": "/h", "port": "acp"}, "periodSeconds": 5}},
			"containerSecurityContext": {"capabilities": {"drop": ["ALL"]}}
		}`,
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	b := cfg.AgentBase
	assert.Equal(t, []string{"regcred"}, b.ImagePullSecrets)
	assert.Equal(t, "platform-rwx", b.StorageClass)
	assert.Equal(t, "ReadWriteOnce", b.AccessMode)
	assert.Equal(t, 30*time.Minute, b.IdleTimeout.AsDuration())
	assert.Equal(t, int64(10), b.TerminationGracePeriod)
	assert.Equal(t, "kata", b.RuntimeClassName)
	assert.Equal(t, "agents", b.NodeSelector["workload"])
	require.Len(t, b.Tolerations, 1)
	assert.Equal(t, "dedicated", b.Tolerations[0].Key)
	require.NotNil(t, b.Probes)
	require.NotNil(t, b.Probes.Startup)
	require.NotNil(t, b.ContainerSecurityContext)
}

func TestLoadFromEnv_AgentTemplateDefaults_Parsed(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
		"AGENT_TEMPLATE_DEFAULTS": `{
			"agentHome": "/home/agent",
			"imagePullPolicy": "IfNotPresent",
			"storageSize": "10Gi",
			"mounts": [{"path": "$HOME", "persist": true}, {"path": "/tmp"}],
			"env": [{"name": "PORT", "value": "8080"}]
		}`,
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	d := cfg.AgentTemplateDefaults
	assert.Equal(t, "/home/agent", d.AgentHome)
	assert.Equal(t, "IfNotPresent", d.ImagePullPolicy)
	assert.Equal(t, "10Gi", d.StorageSize)
	require.Len(t, d.Mounts, 2)
	assert.Equal(t, "$HOME", d.Mounts[0].Path)
	assert.True(t, d.Mounts[0].Persist)
	require.Len(t, d.Env, 1)
	assert.Equal(t, "PORT", d.Env[0].Name)
}

func TestLoadFromEnv_AgentBase_IdleTimeoutZero(t *testing.T) {
	// "0s" disables the idle checker — must round-trip through JSON cleanly.
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
		"AGENT_BASE":            `{"idleTimeout": "0s"}`,
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, time.Duration(0), cfg.AgentBase.IdleTimeout.AsDuration())
}

func TestLoadFromEnv_UnknownFieldRejected(t *testing.T) {
	// Operators who mistype a field name get a loud startup error rather
	// than a silently-ignored value.
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
		"AGENT_BASE":            `{"runtimeClasName": "kata"}`,
	})
	_, err := LoadFromEnv()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "AGENT_BASE")
}

func setEnv(t *testing.T, vars map[string]string) {
	t.Helper()
	for _, key := range []string{
		"PLATFORM_AGENT_NAMESPACE", "PLATFORM_RELEASE_NAMESPACE", "PLATFORM_RELEASE_NAME",
		"PLATFORM_LEASE_NAME", "POD_NAME",
		"AGENT_BASE", "AGENT_TEMPLATE_DEFAULTS",
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
